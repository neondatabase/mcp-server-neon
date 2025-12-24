# Vercel Migration Part 2: Local Testing & Verification

## Overview

This plan covers local testing and verification of the Vercel migration. Part 1 completed the core infrastructure (OAuth routes, MCP handler, dependencies). Part 2 focuses on running the landing Next.js app locally, testing both transports, verifying the OAuth flow, and preparing the Upstash Redis configuration for eventual Vercel deployment.

## Current State Analysis

### Completed (Part 1):

- All OAuth routes migrated to Next.js App Router (`/api/authorize`, `/api/callback`, `/api/token`, `/api/register`)
- OAuth metadata endpoints (`.well-known/oauth-authorization-server`, `.well-known/oauth-protected-resource`)
- Unified MCP handler at `/api/[transport]/route.ts` with DELETE export for SSE cleanup
- Dependencies properly listed in `landing/package.json`
- Import paths updated for Next.js bundler (removed `.js` extensions)
- Analytics auto-initialization for serverless compatibility
- Config with `VERCEL_URL` fallback in `landing/lib/config.ts`
- Cookie handling with HMAC-SHA256 signing

### Key Discoveries:

- `landing/mcp-src/` is a copy of `src/` with modifications for Next.js bundler compatibility (`landing/tsconfig.json:32` excludes some files)
- The `mcp-handler` package uses `REDIS_URL` environment variable for Redis connection
- OAuth token persistence uses `OAUTH_DATABASE_URL` pointing to Postgres via Keyv
- The landing page reads `tools.json` from the landing directory at build time (`landing/app/page.tsx:23`)

## Desired End State

After this plan is complete:

1. The `landing/` Next.js app runs locally without errors
2. Health endpoint returns valid JSON at `http://localhost:3000/api/health`
3. OAuth metadata endpoints return correct configuration
4. Both SSE and Streamable HTTP transports accept connections (with Redis for SSE, without for HTTP)
5. OAuth authorization flow works end-to-end locally
6. Environment variables documented and `.env.local` template created

### Verification:

- `cd landing && npm run dev` starts without errors
- `curl http://localhost:3000/api/health` returns `{"status":"ok",...}`
- `curl http://localhost:3000/.well-known/oauth-authorization-server` returns OAuth config
- MCP Inspector can connect via SSE transport
- OAuth authorize → callback → token flow completes

## What We're NOT Doing

- Deploying to Vercel (Part 3)
- Setting up production Redis/Upstash (preparing config only)
- DNS cutover
- Monitoring setup
- Performance testing

## Implementation Approach

We'll work through local testing in phases:

1. Prerequisites & Environment Setup
2. Build and Start Verification
3. OAuth Flow Testing
4. MCP Transport Testing
5. Upstash Redis Preparation (config changes, no deployment)

---

## Phase 1: Prerequisites & Environment Setup

### Overview

Set up the local development environment with all required dependencies and environment variables.

### Changes Required:

#### 1. Create Landing Environment Template

**File**: `landing/.env.local.example` (NEW)
**Changes**: Create environment template for local development

```bash
# Server configuration
SERVER_HOST=http://localhost:3000
NODE_ENV=development

# OAuth - Upstream Neon OAuth provider
UPSTREAM_OAUTH_HOST=https://oauth2.neon.tech
CLIENT_ID=your-client-id
CLIENT_SECRET=your-client-secret

# Cookie signing secret (generate with: openssl rand -base64 32)
COOKIE_SECRET=your-cookie-secret

# OAuth token storage (Postgres via Keyv)
OAUTH_DATABASE_URL=postgres://user:pass@host:5432/dbname

# Redis for SSE pub/sub (optional for Streamable HTTP)
# For Upstash: UPSTASH_REDIS_REST_URL
# For standard Redis: REDIS_URL=redis://localhost:6379
REDIS_URL=

# Analytics (optional for local dev)
ANALYTICS_WRITE_KEY=

# Sentry (optional for local dev)
SENTRY_DSN=
```

#### 2. Update mcp-handler Redis Config for Upstash Compatibility

**File**: `landing/app/api/[transport]/route.ts`
**Changes**: Support both `UPSTASH_REDIS_REST_URL` and `REDIS_URL`

The `mcp-handler` package accepts `redisUrl` configuration. We should check for Upstash URL first:

```typescript
// Line ~381: Update the options object
{
  redisUrl: process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_URL,
  basePath: '/api',
  maxDuration: 800,
  verboseLogs: process.env.NODE_ENV !== 'production',
}
```

#### 3. Install dependencies

**Command**: Run in `landing/` directory

```bash
npm install
```

### Success Criteria:

#### Automated Verification:

- [x] `cd landing && npm install` completes without errors
- [x] `landing/.env.local.example` exists with all required variables documented
- [x] TypeScript compiles: `cd landing && npm run build` (or `next build`)

#### Manual Verification:

- [ ] `.env.local` file created with valid credentials
- [ ] Can connect to OAuth database URL
- [ ] Cookie secret is set to a secure random value

---

## Phase 2: Build and Start Verification

### Overview

Build the Next.js app and verify basic endpoints work.

### Prerequisites:

- Phase 1 complete
- `tools.json` exists in `landing/` (generated by root `npm run export-tools`)

### Changes Required:

#### 1. Generate tools.json if missing

**Command**: Run from repository root

```bash
npm run build  # This runs tsc and generates dist/
npm run export-tools  # This generates landing/tools.json
```

#### 2. Start Development Server

**Command**: Run in `landing/` directory

```bash
npm run dev
```

### Success Criteria:

#### Automated Verification:

- [x] `landing/tools.json` exists and contains tool definitions
- [x] `npm run dev` starts without compilation errors
- [x] `curl http://localhost:3000/api/health` returns:
  ```json
  { "status": "ok", "version": "X.X.X", "timestamp": "..." }
  ```
- [x] `curl http://localhost:3000/.well-known/oauth-authorization-server` returns valid JSON with endpoints

#### Manual Verification:

- [ ] Landing page loads at `http://localhost:3000`
- [ ] Tools are displayed in accordion on landing page
- [ ] No console errors in browser dev tools

---

## Phase 3: OAuth Flow Testing

### Overview

Test the complete OAuth authorization flow locally.

### Prerequisites:

- Phase 2 complete
- Valid `CLIENT_ID` and `CLIENT_SECRET` configured
- `OAUTH_DATABASE_URL` pointing to accessible Postgres database

### Test Flow:

#### 1. Client Registration

**Test**: Register a test MCP client

```bash
curl -X POST http://localhost:3000/api/register \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "Test MCP Client",
    "redirect_uris": ["http://localhost:8080/callback"],
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"],
    "token_endpoint_auth_method": "none"
  }'
```

Expected response:

```json
{
  "client_id": "...",
  "client_secret": "...",
  "client_name": "Test MCP Client",
  ...
}
```

#### 2. Authorization Initiation

**Test**: Start OAuth flow (opens in browser)

Open in browser:

```
http://localhost:3000/api/authorize?response_type=code&client_id=<registered_client_id>&redirect_uri=http://localhost:8080/callback&scope=read%20write&state=test123
```

Expected: Shows approval dialog, then redirects to Neon OAuth

#### 3. Token Exchange

After callback with authorization code:

```bash
curl -X POST http://localhost:3000/api/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&code=<auth_code>&redirect_uri=http://localhost:8080/callback&client_id=<client_id>"
```

### Success Criteria:

#### Automated Verification:

- [x] Client registration returns valid `client_id` and `client_secret`
- [x] OAuth metadata endpoints return correct URLs

#### Manual Verification:

- [ ] Approval dialog appears for new clients
- [ ] Approval dialog is skipped for previously approved clients (cookie check)
- [ ] Redirect to Neon OAuth works
- [ ] Callback receives authorization code
- [ ] Token exchange returns `access_token` and `refresh_token`
- [ ] Token refresh works with valid refresh token

---

## Phase 4: MCP Transport Testing

### Overview

Test both SSE and Streamable HTTP transports using MCP Inspector.

### Prerequisites:

- Phase 2 complete
- For SSE: Redis running locally or Upstash credentials set
- MCP Inspector installed: `npm i -g @modelcontextprotocol/inspector`

### Transport Paths:

- SSE: `/api/sse` (requires Redis for multi-instance pub/sub)
- Streamable HTTP: `/api/mcp` (no Redis required, simpler setup)

### Test Procedure:

#### 1. Streamable HTTP Transport (Easier - No Redis)

**Test without Redis first**

```bash
# In landing/.env.local, leave REDIS_URL empty
# Start dev server
npm run dev

# In another terminal, use MCP Inspector
npx @modelcontextprotocol/inspector http://localhost:3000/api/mcp
```

The inspector will prompt for authentication. You'll need a valid Neon API key.

#### 2. SSE Transport (Requires Redis)

**Start local Redis** (if not using Upstash):

```bash
docker run -d -p 6379:6379 redis:7-alpine
```

Update `.env.local`:

```bash
REDIS_URL=redis://localhost:6379
```

Restart dev server and test:

```bash
npx @modelcontextprotocol/inspector http://localhost:3000/api/sse
```

### Success Criteria:

#### Automated Verification:

- [x] `/api/mcp` endpoint accepts POST requests with `Content-Type: application/json`
- [x] `/api/sse` endpoint establishes SSE connection with `Accept: text/event-stream`

#### Manual Verification:

- [ ] MCP Inspector connects successfully to Streamable HTTP transport
- [ ] MCP Inspector shows server info and capabilities
- [ ] MCP Inspector lists all available tools
- [ ] A tool can be invoked and returns results (e.g., `list_projects`)
- [ ] SSE transport works when Redis is available
- [ ] SSE connection stays alive and handles multiple requests

---

## Phase 5: Upstash Redis Preparation

### Overview

Prepare the configuration for Upstash Redis on Vercel, but don't deploy yet.

### Changes Required:

#### 1. Document Upstash Environment Variables

**File**: `landing/.env.local.example`
**Changes**: Add Upstash-specific documentation

Add to the file:

```bash
# Redis for SSE pub/sub
# Option 1: Upstash Redis REST API (recommended for Vercel)
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=xxx

# Option 2: Standard Redis (for local development)
REDIS_URL=redis://localhost:6379
```

#### 2. Verify mcp-handler Upstash Compatibility

**Research**: Check `mcp-handler` documentation for Upstash support

The `mcp-handler` package may use different Redis clients:

- Standard `redis` package (requires `REDIS_URL`)
- `@upstash/redis` REST client (requires `UPSTASH_REDIS_REST_URL`)

If `mcp-handler` only supports standard Redis, we may need to:

1. Use Upstash Redis's TCP connection string (not REST API)
2. Or submit a PR to mcp-handler for Upstash REST support

**Verification command** (check mcp-handler source):

```bash
npm show mcp-handler dependencies
```

### Success Criteria:

#### Automated Verification:

- [x] Environment variable documentation updated
- [x] Redis URL format requirements documented

#### Manual Verification:

- [x] Understand if mcp-handler supports Upstash REST API
  - **Finding**: mcp-handler uses standard `redis` npm package (v4.6.0) which requires TCP connections
- [x] If not, document TCP connection string approach for Upstash
  - **Documented**: Use `rediss://default:<password>@<endpoint>:6379` format from Upstash console
- [x] Create notes for Part 3 (Vercel deployment) about Redis setup
  - **Note**: Upstash provides TCP endpoints compatible with standard Redis clients

---

## Testing Strategy

### Unit Tests:

- N/A for this phase (infrastructure testing)

### Integration Tests:

- OAuth flow end-to-end
- MCP tool invocation via both transports

### Manual Testing Steps:

1. Start landing dev server: `cd landing && npm run dev`
2. Verify health endpoint: `curl http://localhost:3000/api/health`
3. Verify OAuth metadata: `curl http://localhost:3000/.well-known/oauth-authorization-server`
4. Register test client via `/api/register`
5. Start OAuth flow in browser
6. Complete Neon login and return to callback
7. Exchange code for tokens via `/api/token`
8. Use MCP Inspector to test Streamable HTTP transport
9. (Optional) Start Redis and test SSE transport

## Environment Variables Summary

| Variable                 | Required    | Description                                                  |
| ------------------------ | ----------- | ------------------------------------------------------------ |
| `SERVER_HOST`            | Yes         | Base URL for OAuth redirects (http://localhost:3000 for dev) |
| `UPSTREAM_OAUTH_HOST`    | Yes         | Neon OAuth provider (https://oauth2.neon.tech)               |
| `CLIENT_ID`              | Yes         | OAuth client ID from Neon                                    |
| `CLIENT_SECRET`          | Yes         | OAuth client secret from Neon                                |
| `COOKIE_SECRET`          | Yes         | Secret for signing cookies                                   |
| `OAUTH_DATABASE_URL`     | Yes         | Postgres connection string for token storage                 |
| `REDIS_URL`              | SSE only    | Redis connection URL for SSE pub/sub                         |
| `UPSTASH_REDIS_REST_URL` | Alternative | Upstash Redis REST URL                                       |
| `ANALYTICS_WRITE_KEY`    | No          | Segment analytics key                                        |
| `SENTRY_DSN`             | No          | Sentry DSN for error tracking                                |

## References

- Original migration status: `/Users/pedro.figueiredo/.cursor/plans/vercel_migration_status_14a0564e.plan.md`
- MCP Handler docs: https://github.com/anthropics/mcp-handler
- Upstash Redis: https://upstash.com/docs/redis
- MCP Inspector: https://github.com/anthropics/mcp-inspector
