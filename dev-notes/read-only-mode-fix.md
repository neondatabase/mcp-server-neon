# Read-Only Mode Fix

**Date:** 2026-01-14
**Commit:** 7bb3e65
**Branch:** fix-read-only-mode
**Category:** security / access-control

---

## Problem Summary

The MCP server's read-only mode was not being properly determined from OAuth scopes or request headers. The `readOnly` flag was always hardcoded to `false` in the `verifyToken` function, making the read-only filtering logic in the server ineffective.

## Symptoms

- Users with OAuth tokens containing only the `read` scope could still access write-only tools (e.g., `create_project`, `delete_branch`)
- The `X-READ-ONLY` header had no effect on tool availability
- The `scopes_supported` field was missing from the OAuth authorization server metadata

## Root Cause

In `landing/app/api/[transport]/route.ts`, the `verifyToken` function was returning `readOnly: false` in both code paths (OAuth tokens and API keys):

```typescript
// OAuth path - hardcoded to false
return {
  // ...
  extra: {
    // ...
    readOnly: false,  // BUG: Should be determined from scope
  },
};

// API key path - hardcoded to false
return {
  // ...
  extra: {
    // ...
    readOnly: false,  // BUG: Should be determined from header
  },
};
```

The server did have proper filtering logic in `landing/mcp-src/server/index.ts`:

```typescript
const availableTools = context.readOnly
  ? NEON_TOOLS.filter((tool) => tool.readOnlySafe)
  : NEON_TOOLS;
```

But this logic never activated because `context.readOnly` was always `false`.

## Solution

### 1. Created `landing/mcp-src/utils/read-only.ts`

A new utility module with clear priority rules:

```typescript
export const SUPPORTED_SCOPES = ['read', 'write', '*'] as const;

export type ReadOnlyContext = {
  headerValue?: string | null;
  scope?: string | string[] | null;
};

/**
 * Determines if the request should operate in read-only mode.
 * Priority: X-READ-ONLY header > OAuth scope > default (false)
 */
export function isReadOnly(context: ReadOnlyContext): boolean {
  // 1. Check X-READ-ONLY header first (explicit override)
  const headerResult = parseReadOnlyHeader(context.headerValue);
  if (headerResult !== undefined) {
    return headerResult;
  }

  // 2. Check OAuth scope (only 'read' scope = read-only)
  if (context.scope !== undefined && context.scope !== null) {
    return isScopeReadOnly(context.scope);
  }

  // 3. Default to read-write access
  return false;
}
```

Key design decisions:
- **Priority order:** Header > Scope > Default - allows explicit override via header
- **Scope parsing:** Handles both string (`"read write"`) and array (`["read", "write"]`) formats
- **Read-only determination:** Only read-only if scope contains ONLY `read` (no `write`, no `*`)

### 2. Updated `landing/app/api/[transport]/route.ts`

Modified `verifyToken` to use the new utility:

```typescript
const readOnlyHeader = req.headers.get('x-read-only');

// OAuth path
const readOnly = isReadOnly({
  headerValue: readOnlyHeader,
  scope: token.scope,
});

// API key path (no OAuth scopes)
const readOnly = isReadOnly({
  headerValue: readOnlyHeader,
});
```

### 3. Updated OAuth metadata

Added `scopes_supported` to `landing/app/.well-known/oauth-authorization-server/route.ts`:

```typescript
scopes_supported: SUPPORTED_SCOPES,
```

This allows clients to discover what scopes the server supports.

## Files Changed

| File | Change |
|------|--------|
| `landing/mcp-src/utils/read-only.ts` | **New file** - Read-only mode detection logic |
| `landing/app/api/[transport]/route.ts` | Use `isReadOnly()` for both OAuth and API key paths |
| `landing/app/.well-known/oauth-authorization-server/route.ts` | Add `scopes_supported` to metadata |

## Testing

### Manual Testing

1. **OAuth with `read` scope only:**
   ```bash
   # Should only see read-only tools
   curl -H "Authorization: Bearer <read-only-token>" https://mcp.neon.tech/api/mcp
   ```

2. **X-READ-ONLY header:**
   ```bash
   # Force read-only mode even with full-access token
   curl -H "Authorization: Bearer <token>" \
        -H "X-READ-ONLY: true" \
        https://mcp.neon.tech/api/mcp
   ```

3. **API key with header override:**
   ```bash
   # API keys default to read-write, but header can restrict
   curl -H "Authorization: Bearer <api-key>" \
        -H "X-READ-ONLY: true" \
        https://mcp.neon.tech/api/mcp
   ```

### Verification

Check that read-only mode properly filters tools:
- `list_projects` (readOnlySafe: true) - Should be available
- `create_project` (readOnlySafe: false) - Should NOT be available in read-only mode

## Prevention

### Design Pattern for Future Features

When adding new authentication or authorization features:

1. **Don't hardcode access levels** - Always derive from actual auth context
2. **Create dedicated utility modules** - Centralize access control logic
3. **Document priority rules** - Make override behavior explicit
4. **Test all auth paths** - OAuth tokens AND API keys

### Code Review Checklist

- [ ] Search for hardcoded `readOnly: false` or similar access flags
- [ ] Verify all auth paths use the same access determination logic
- [ ] Check OAuth metadata exposes supported scopes/capabilities
- [ ] Test header overrides work correctly

## Related Documentation

- **CLAUDE.md** - Documents the read-only mode design:
  > Read-Only Mode (`landing/mcp-src/utils/read-only.ts`): Tools define a `readOnlySafe` property. When the server runs in read-only mode, only tools marked as `readOnlySafe: true` are available.

- **Tool definitions** - Each tool in `landing/mcp-src/tools/definitions.ts` has:
  - `readOnlySafe: boolean` - Whether the tool is safe for read-only mode
  - `annotations.readOnlyHint` - MCP standard hint for clients

## Summary

| Aspect | Before | After |
|--------|--------|-------|
| OAuth scope detection | Ignored | Properly reads `token.scope` |
| X-READ-ONLY header | Ignored | Highest priority override |
| OAuth metadata | Missing scopes | Includes `scopes_supported` |
| Tool filtering | Always all tools | Filtered by `readOnlySafe` |
