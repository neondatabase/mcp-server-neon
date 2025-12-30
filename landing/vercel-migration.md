# Vercel Migration Guide

This document outlines the changes made to migrate the Neon MCP Server from an Express-based deployment to Vercel's serverless infrastructure using Next.js App Router.

## Overview

The migration moved the remote MCP server from Express-based SSE/Streamable HTTP transports to Vercel's serverless functions, leveraging the `mcp-handler` library for MCP protocol handling and Next.js App Router for routing.

## Key Changes

### 1. Next.js Configuration

**`next.config.ts`**

- Removed `output: 'export'` to enable dynamic server-side rendering required for API routes
- Serverless deployment now uses Vercel's edge infrastructure

**`vercel.json`**

- Configured Vercel Fluid Compute for long-running SSE connections:
  ```json
  {
    "fluid": true,
    "functions": {
      "app/api/**/*.ts": {
        "maxDuration": 800
      }
    }
  }
  ```
- `fluid: true` enables Fluid Compute mode for SSE/streaming support
- `maxDuration: 800` allows functions to run up to 800 seconds (SSE requirement)

### 2. New API Route Structure

Created Next.js App Router API routes to replace Express endpoints:

| Route                                              | Purpose                                |
| -------------------------------------------------- | -------------------------------------- |
| `/api/[transport]/route.ts`                        | Main MCP handler (SSE/Streamable HTTP) |
| `/api/authorize/route.ts`                          | OAuth authorization endpoint           |
| `/api/callback/route.ts`                           | OAuth callback handler                 |
| `/api/token/route.ts`                              | OAuth token exchange                   |
| `/api/revoke/route.ts`                             | OAuth token revocation                 |
| `/api/register/route.ts`                           | Dynamic client registration            |
| `/api/health/route.ts`                             | Health check endpoint                  |
| `/.well-known/oauth-authorization-server/route.ts` | OAuth server metadata                  |
| `/.well-known/oauth-protected-resource/route.ts`   | OAuth protected resource metadata      |

### 3. MCP Handler Integration

The `mcp-handler` library provides the core MCP functionality:

```typescript
import { createMcpHandler, withMcpAuth } from 'mcp-handler';

const handler = createMcpHandler(serverFactory, tools, options, {
  redisUrl: process.env.KV_URL || process.env.REDIS_URL,
  basePath: '/api',
  maxDuration: 300,
  verboseLogs: process.env.NODE_ENV !== 'production',
});

const authHandler = withMcpAuth(handler, verifyToken, authOptions);
export { authHandler as GET, authHandler as POST, authHandler as DELETE };
```

### 4. `mcp-handler` Patch

Created `patches/mcp-handler+1.0.4.patch` to fix compatibility issues:

1. **rawHeaders support**: Added `rawHeaders` array to fake request for `@hono/node-server` compatibility
2. **Buffer handling**: Fixed Buffer to Uint8Array conversion instead of throwing errors

Uses `patch-package` via postinstall script.

### 5. OAuth System Refactoring

#### New `lib/oauth/` Directory

Created Next.js-compatible OAuth utilities:

**`lib/oauth/client.ts`**

- Moved OAuth client logic using `openid-client` library
- Handles upstream authentication with Neon OAuth provider
- Functions: `upstreamAuth()`, `exchangeCode()`, `exchangeRefreshToken()`

**`lib/oauth/cookies.ts`**

- Replaced Express cookie handling with Next.js `cookies()` API
- Uses Web Crypto API (HMAC-SHA256) for signed cookies
- Functions: `isClientAlreadyApproved()`, `updateApprovedClientsCookie()`

**`lib/config.ts`**

- Centralized configuration with Vercel environment variable support
- Uses `VERCEL_URL` as fallback for preview deployments

### 6. Import Path Changes

Converted all `.js` extensions to extensionless imports for Next.js/bundler compatibility:

```typescript
// Before
import { logger } from '../utils/logger.js';

// After
import { logger } from '../utils/logger';
```

### 7. Vercel Functions Integration (`@vercel/functions`)

Added `@vercel/functions` package for serverless lifecycle management:

**`waitUntil` for Background Tasks**

Vercel serverless functions terminate immediately after returning a response. The `waitUntil` function extends the function lifecycle to allow background tasks (like analytics) to complete:

```typescript
import { waitUntil } from '@vercel/functions';
import { flushAnalytics } from '../../../mcp-src/analytics/analytics';

// Inside request handlers
waitUntil(flushAnalytics());
```

This ensures analytics events are flushed before the function terminates, without blocking the response.

### 8. Analytics for Serverless

Modified `analytics/analytics.ts` for serverless compatibility:

**Auto-Initialization at Module Load**

```typescript
// Before: Manual initialization
let analytics: Analytics | undefined;
export const initAnalytics = () => {
  if (ANALYTICS_WRITE_KEY) {
    analytics = new Analytics({ ... });
  }
};

// After: Auto-initialization at module load
const analytics: Analytics | undefined = ANALYTICS_WRITE_KEY
  ? new Analytics({
      writeKey: ANALYTICS_WRITE_KEY,
      host: 'https://track.neon.tech',
      flushAt: 1, // Send immediately (required for serverless)
    })
  : undefined;
```

**Flush Function for Serverless Lifecycle**

```typescript
export const flushAnalytics = async (): Promise<void> => {
  await analytics?.closeAndFlush();
};
```

Key changes:
- `flushAt: 1` ensures events are sent immediately (serverless functions may terminate before batched events are sent)
- `flushAnalytics()` called via `waitUntil()` before function termination

### 9. Tool Handler Parameter Wrapping

Updated tool handler calls to wrap args in expected structure:

```typescript
// Before
return await toolHandler(args, neonClient, extraArgs);

// After
return await toolHandler({ params: args }, neonClient, extraArgs);
```

### 10. Response Content Changes

Removed `metadata` fields from tool response content (not supported in serverless):

```typescript
// Before
{
  type: 'text',
  text: branchInfo(branch),
  metadata: branch,
}

// After
{
  type: 'text',
  text: branchInfo(branch),
}
```

For complex data, raw JSON is now embedded in the text response.

### 11. TypeScript Configuration

Updated `tsconfig.json`:

- Module resolution: `bundler` (instead of `node16`)
- Excluded transport files not used in Vercel deployment:
  - `mcp-src/index.ts`
  - `mcp-src/transports/sse-express.ts`
  - `mcp-src/transports/stdio.ts`
  - `mcp-src/transports/stream.ts`

### 12. Redis/Session Storage

Updated Redis URL configuration for Upstash support:

```typescript
redisUrl: process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_URL,
```

### 13. New Dependencies

Added to `package.json`:

**Runtime:**

- `@keyv/postgres` - Token/session storage
- `@neondatabase/api-client` - Neon API client
- `@neondatabase/serverless` - Serverless Postgres driver
- `@segment/analytics-node` - Analytics
- `@sentry/node` - Error tracking
- `@vercel/functions` - Vercel serverless utilities (`waitUntil`)
- `express` - For type compatibility
- `keyv` - Key-value store
- `morgan` - Logging
- `oauth2-server` - OAuth implementation
- `openid-client` - OIDC client
- `winston` - Logging
- `dotenv` - Environment configuration

**Dev:**

- `patch-package` - For mcp-handler patch
- `@types/oauth2-server` - Type definitions

### 14. Export Type Fix

Fixed type exports in `tools/index.ts`:

```typescript
// Before
export { ToolHandlers, ToolHandlerExtended } from './types.js';

// After
export type { ToolHandlers, ToolHandlerExtended } from './types';
```

### 15. Vercel Environment Variable Handling

**`lib/config.ts`** provides centralized configuration with Vercel-specific fallbacks:

```typescript
// Server host detection with Vercel fallback
export const SERVER_HOST =
  process.env.SERVER_HOST ||
  (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000');
```

Vercel automatically provides `VERCEL_URL` - the deployment URL (e.g., `my-app-abc123.vercel.app`).

**Note:** In production, always set `SERVER_HOST` explicitly to ensure stable OAuth callbacks.

### 16. GitHub Actions Changes

Adapted CI/CD workflows for Vercel deployment:

- **Removed** `koyeb-preview.yml` and `koyeb-prod.yml` (no longer needed)
- **Updated** `pr.yml` to work from `landing/` directory:
  - Changed `working-directory` to `landing`
  - Uses Node 22 and Bun 1.2.13
  - Lint and build commands run in landing directory

Vercel handles deployments automatically via GitHub integration (no manual workflows needed).

## Environment Variables

Required for Vercel deployment:

| Variable              | Description                                                    |
| --------------------- | -------------------------------------------------------------- |
| `SERVER_HOST`         | Server URL (falls back to `VERCEL_URL`)                        |
| `VERCEL_URL`          | Auto-provided by Vercel - deployment URL                       |
| `UPSTREAM_OAUTH_HOST` | Neon OAuth provider URL                                        |
| `CLIENT_ID`           | OAuth client ID                                                |
| `CLIENT_SECRET`       | OAuth client secret                                            |
| `COOKIE_SECRET`       | Secret for signed cookies                                      |
| `KV_URL`              | Redis URL for session storage (Vercel KV / Upstash)            |
| `REDIS_URL`           | Redis URL fallback for local development                       |
| `OAUTH_DATABASE_URL`  | Postgres URL for token storage                                 |
| `SENTRY_DSN`          | Sentry error tracking DSN                                      |
| `ANALYTICS_WRITE_KEY` | Segment analytics write key                                    |

## Migration Checklist

- [x] Create Next.js API routes for OAuth flow
- [x] Create Next.js API routes for MCP handler
- [x] Create `.well-known` routes for OAuth discovery
- [x] Refactor OAuth utilities for Next.js compatibility
- [x] Update import paths (remove `.js` extensions)
- [x] Configure `vercel.json` for Fluid Compute (`fluid: true`, `maxDuration: 800`)
- [x] Patch `mcp-handler` for compatibility
- [x] Update analytics for serverless (auto-init, `flushAt: 1`, `waitUntil`)
- [x] Update TypeScript configuration
- [x] Add required dependencies (including `@vercel/functions`)
- [x] Update tool handler parameter structure
- [x] Remove metadata from response content
- [x] Remove debug console.logs from production code
- [x] Fix Redis URL environment variable documentation
- [x] Add `VERCEL_URL` handling in `lib/config.ts`
- [x] Remove Koyeb deployment workflows
- [x] Update GitHub Actions to work from `landing/` directory
- [x] Add token revoke endpoint (`/api/revoke`)
- [x] Add OpenGraph meta tags
- [ ] Test OAuth flow end-to-end
- [ ] Test MCP tool execution
- [ ] Verify SSE streaming works with Fluid Compute
- [ ] Deploy to Vercel preview environment
- [ ] Production deployment

## Notes

### Vercel-Specific Considerations

- **Fluid Compute**: Enable with `"fluid": true` in `vercel.json` for SSE/streaming support up to 800s
- **Function Duration**: Set `maxDuration: 800` for API routes that handle long-lived connections
- **`waitUntil`**: Use `@vercel/functions` `waitUntil()` for background tasks (analytics, logging) that should complete after response is sent
- **Environment Variables**: `VERCEL_URL` is auto-provided; set `SERVER_HOST` explicitly in production for stable OAuth callbacks
- **No Custom Deployment Workflows**: Vercel handles CI/CD automatically via GitHub integration

### General Architecture Notes

- The `mcp-handler` library abstracts much of the MCP protocol complexity
- OAuth flow uses Neon's OAuth provider as the upstream authorization server
- Token storage uses Postgres via Keyv for persistence
- Session state for approved clients stored in signed HTTP-only cookies
- Analytics uses Segment with `flushAt: 1` for immediate event delivery in serverless context
