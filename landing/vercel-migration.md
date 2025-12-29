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

- Configured function limits for API routes:
  - `maxDuration: 300` (Fluid Compute - supports up to 800s for SSE connections)
  - `memory: 1024` MB

### 2. New API Route Structure

Created Next.js App Router API routes to replace Express endpoints:

| Route                                              | Purpose                                |
| -------------------------------------------------- | -------------------------------------- |
| `/api/[transport]/route.ts`                        | Main MCP handler (SSE/Streamable HTTP) |
| `/api/authorize/route.ts`                          | OAuth authorization endpoint           |
| `/api/callback/route.ts`                           | OAuth callback handler                 |
| `/api/token/route.ts`                              | OAuth token exchange                   |
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

### 7. Analytics Auto-Initialization

Modified `analytics/analytics.ts` for serverless compatibility:

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
  ? new Analytics({ ... })
  : undefined;

export const initAnalytics = () => {
  // No-op: backwards compatibility
};
```

### 8. Tool Handler Parameter Wrapping

Updated tool handler calls to wrap args in expected structure:

```typescript
// Before
return await toolHandler(args, neonClient, extraArgs);

// After
return await toolHandler({ params: args }, neonClient, extraArgs);
```

### 9. Response Content Changes

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

### 10. TypeScript Configuration

Updated `tsconfig.json`:

- Module resolution: `bundler` (instead of `node16`)
- Excluded transport files not used in Vercel deployment:
  - `mcp-src/index.ts`
  - `mcp-src/transports/sse-express.ts`
  - `mcp-src/transports/stdio.ts`
  - `mcp-src/transports/stream.ts`

### 11. Redis/Session Storage

Updated Redis URL configuration for Upstash support:

```typescript
redisUrl: process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_URL,
```

### 12. New Dependencies

Added to `package.json`:

**Runtime:**

- `@keyv/postgres` - Token/session storage
- `@neondatabase/api-client` - Neon API client
- `@neondatabase/serverless` - Serverless Postgres driver
- `@segment/analytics-node` - Analytics
- `@sentry/node` - Error tracking
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

### 13. Export Type Fix

Fixed type exports in `tools/index.ts`:

```typescript
// Before
export { ToolHandlers, ToolHandlerExtended } from './types.js';

// After
export type { ToolHandlers, ToolHandlerExtended } from './types';
```

## Environment Variables

Required for Vercel deployment:

| Variable              | Description                                                    |
| --------------------- | -------------------------------------------------------------- |
| `SERVER_HOST`         | Server URL (falls back to `VERCEL_BRANCH_URL` or `VERCEL_URL`) |
| `UPSTREAM_OAUTH_HOST` | Neon OAuth provider URL                                        |
| `CLIENT_ID`           | OAuth client ID                                                |
| `CLIENT_SECRET`       | OAuth client secret                                            |
| `COOKIE_SECRET`       | Secret for signed cookies                                      |
| `KV_URL`              | Redis URL for session storage (Vercel KV)                      |
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
- [x] Configure `vercel.json` for Fluid Compute
- [x] Patch `mcp-handler` for compatibility
- [x] Update analytics for auto-initialization
- [x] Update TypeScript configuration
- [x] Add required dependencies
- [x] Update tool handler parameter structure
- [x] Remove metadata from response content
- [x] Remove debug console.logs from production code
- [x] Fix Redis URL environment variable documentation
- [ ] Test OAuth flow end-to-end
- [ ] Test MCP tool execution
- [ ] Verify SSE streaming works with Fluid Compute
- [ ] Deploy to Vercel preview environment
- [ ] Production deployment

## Notes

- Vercel Fluid Compute supports up to 800s function duration for SSE connections
- The `mcp-handler` library abstracts much of the MCP protocol complexity
- OAuth flow uses Neon's OAuth provider as the upstream authorization server
- Token storage uses Postgres via Keyv for persistence
- Session state for approved clients stored in signed HTTP-only cookies
