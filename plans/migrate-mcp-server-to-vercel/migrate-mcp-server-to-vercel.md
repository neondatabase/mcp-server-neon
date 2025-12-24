# feat: Migrate MCP Server from Koyeb to Vercel

## Overview

Migrate the Neon MCP Server from its current Docker-based deployment on Koyeb to Vercel's serverless infrastructure. This migration will leverage Vercel's native MCP support, Fluid Compute for extended execution times, and the official `@vercel/mcp-handler` package.

## Problem Statement / Motivation

**Current State:**

- MCP server deployed as Docker container on Koyeb (long-running Express server on port 3001)
- Uses two transports: SSE and Streamable HTTP
- OAuth 2.0 with Postgres-backed session storage using Keyv + `@keyv/postgres`
- Requires infrastructure management, manual scaling, and Docker maintenance

**Why Vercel with Fluid Compute:**

- **Fluid Compute** - NOT standard serverless. Key differences:
  - Up to **800s execution time** (vs 60s standard)
  - **Connection reuse** - multiple requests can share same instance
  - **Optimized concurrency** - maintains state between invocations on same instance
  - **~90% cost savings** reported vs traditional serverless
- Native MCP server support with `mcp-handler`
- Built-in OAuth support in mcp-handler v1.0.0
- Next.js landing page can be deployed natively
- Zero infrastructure management, automatic HTTPS, and global edge network

**Fluid Compute vs Standard Serverless:**

| Feature            |      Standard Serverless | Fluid Compute                 |
| ------------------ | -----------------------: | :---------------------------- |
| Execution timeout  |                      60s | **800s**                      |
| Instance reuse     |                       No | **Yes**                       |
| In-memory state    | Lost between invocations | **Persists on same instance** |
| Connection pooling |    Creates new each time | **Reuses connections**        |
| SSE viability      |            ❌ Not viable | ✅ **Works well**             |

**Key Trade-offs:**

- Requires Vercel Pro plan for Fluid Compute
- Express.js requires refactoring to Vercel Functions pattern
- Redis still recommended for SSE session persistence across instances

## Proposed Solution

### Architecture Decision: Transport Strategy

**Requirement: Support Both SSE and Streamable HTTP**

Many existing users rely on SSE transport, so we must support both transports in the Vercel deployment.

| Transport       | Serverless Compatible | Session State | Timeout                              | Support Level |
| --------------- | --------------------- | ------------- | ------------------------------------ | ------------- |
| Streamable HTTP | ✅ Yes (stateless)    | None needed   | No limit (request/response)          | **Primary**   |
| SSE             | ⚠️ Requires Redis     | Redis-backed  | 60s default, 800s with Fluid Compute | **Required**  |

**SSE Support Strategy with Fluid Compute + Redis:**

Combining Fluid Compute with Upstash Redis provides the most robust SSE architecture:

1. **800s timeout** - Long-running SSE connections are viable
2. **Instance reuse** - Fluid Compute optimizes performance
3. **Redis pub/sub** - Guarantees session persistence across all scenarios
4. **No edge cases** - Works during scale-out, redeploys, and instance restarts

**Storage Architecture:**

| Purpose      | Provider            | Required? | Why                                      |
| ------------ | ------------------- | --------- | ---------------------------------------- |
| OAuth Data   | **Neon** (existing) | ✅ Yes    | Relational data - tokens, clients, codes |
| SSE Sessions | **Upstash Redis**   | ✅ Yes    | Cross-instance session pub/sub           |

**Decision: Upstash Redis from Day 1**

Redis ensures SSE reliability in all scenarios:

- ✅ Scale-out (multiple instances)
- ✅ Deployments (instance restarts)
- ✅ Cold starts (new instances)
- ✅ High availability

**Upstash Setup:**

- Available via Vercel Marketplace (one-click integration)
- Free tier: 10,000 commands/day
- Unified billing through Vercel dashboard

**Why keep SSE:**

- Large existing user base relies on SSE
- Some MCP clients (older versions) only support SSE
- Gradual migration path allows users to adopt Streamable HTTP at their own pace

**SSE Architecture on Vercel:**

```
┌────────────────────────────────────────────────────────────────┐
│                    SSE Connection Flow                          │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Client                    Vercel                    Redis      │
│    │                         │                         │        │
│    │──GET /api/sse───────────▶│                         │        │
│    │                         │──Store session───────────▶│        │
│    │◀──SSE stream open───────│                         │        │
│    │                         │                         │        │
│    │──POST /api/messages─────▶│                         │        │
│    │   ?sessionId=xyz        │──Lookup session─────────▶│        │
│    │                         │◀─Return transport state──│        │
│    │                         │──Process message──────────        │
│    │◀──SSE event─────────────│                                  │
│    │                         │                                  │
│  (connection may hit         │                                  │
│   different function         │                                  │
│   instances)                 │                                  │
└────────────────────────────────────────────────────────────────┘
```

**SSE Timeout Strategy with Fluid Compute:**

Vercel's **Fluid Compute** feature enables extended execution times, making SSE viable:

| Plan                    | Timeout            | SSE Viability      |
| ----------------------- | ------------------ | ------------------ |
| Hobby                   | 10s                | ❌ Not viable      |
| Pro                     | 60s                | ⚠️ Limited         |
| **Pro + Fluid Compute** | **800s (13+ min)** | ✅ **Recommended** |

**Fluid Compute Benefits:**

- **Up to 800 seconds** execution time (vs 60s default)
- **Optimized concurrency** - multiple invocations share resources
- **Connection reuse** - better for database and Redis connections
- **~90% cost savings** reported by some users vs standard serverless

**Configuration:**

```json
// vercel.json
{
  "functions": {
    "app/api/**/*.ts": {
      "maxDuration": 800,
      "memory": 1024
    }
  }
}
```

Enable Fluid Compute in Vercel Project Settings → Functions → Enable Fluid Compute.

### High-Level Architecture (Fluid Compute + Redis)

```
┌───────────────────────────────────────────────────────────────────────────┐
│                    Vercel Deployment (Fluid Compute)                       │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌─────────────────┐    ┌───────────────────────┐    ┌─────────────────┐ │
│  │  Landing Page   │    │    MCP Functions      │    │ OAuth Functions │ │
│  │  (Next.js)      │    │    (Fluid Compute)    │    │                 │ │
│  │  /              │    │                       │    │  /api/authorize │ │
│  │  /docs          │    │  /api/mcp (POST)      │    │  /api/callback  │ │
│  │  /tools         │    │  /api/sse (GET)       │    │  /api/token     │ │
│  └─────────────────┘    │  /api/messages (POST) │    │  /api/register  │ │
│                         └───────────┬───────────┘    └────────┬────────┘ │
│                                     │                         │          │
│                           ┌─────────┴─────────┐               │          │
│                           ▼                   ▼               ▼          │
│                  ┌────────────────┐  ┌────────────────────────────────┐  │
│                  │ Upstash Redis  │  │   Neon Postgres (OAuth DB)     │  │
│                  │ (SSE pub/sub)  │  │   (EXISTING - keep as-is!)     │  │
│                  │                │  │   Tokens, Clients, Codes       │  │
│                  └────────────────┘  └────────────────────────────────┘  │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │                    External Services                                 │ │
│  │  ├── Neon API (tool operations)                                     │ │
│  │  ├── Neon OAuth Provider (upstream auth)                            │ │
│  │  ├── Segment Analytics                                               │ │
│  │  └── Sentry Error Tracking                                           │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────┘
```

### Route Structure

The `mcp-handler` package uses a **dynamic `[transport]` route** pattern that automatically handles both SSE and Streamable HTTP transports based on the URL path.

```
app/
├── api/
│   ├── [transport]/
│   │   └── route.ts              # Handles /api/mcp (HTTP) AND /api/sse (SSE)
│   ├── authorize/
│   │   └── route.ts              # GET/POST - OAuth authorization
│   ├── callback/
│   │   └── route.ts              # GET - OAuth callback
│   ├── token/
│   │   └── route.ts              # POST - Token exchange
│   ├── register/
│   │   └── route.ts              # POST - Client registration
│   ├── health/
│   │   └── route.ts              # GET - Health check
│   └── .well-known/
│       ├── oauth-authorization-server/
│       │   └── route.ts          # GET - OAuth server metadata
│       └── oauth-protected-resource/
│           └── route.ts          # GET - Protected resource metadata
├── page.tsx                       # Landing page (from landing/)
└── ...
```

**Key Insight:** The `[transport]` dynamic segment routes:

- `/api/mcp` → Streamable HTTP transport (stateless)
- `/api/sse` → SSE transport (requires Redis)

Both are handled by the same route file!

## Technical Approach

### Phase 1: Foundation & Proof of Concept

#### 1.1 Create Vercel Project Structure

**New Files:**

```
vercel.json                        # Vercel configuration
app/
├── api/
│   └── [transport]/
│       └── route.ts              # Unified MCP handler (SSE + Streamable HTTP)
├── layout.tsx
└── page.tsx
next.config.ts                    # Next.js config for Vercel
```

**`vercel.json`:**

```json
{
  "functions": {
    "app/api/**/*.ts": {
      "maxDuration": 800,
      "memory": 1024
    }
  },
  "env": {
    "NODE_ENV": "production"
  }
}
```

**Note:** Requires Vercel Pro plan with Fluid Compute enabled for 800s timeout.

#### 1.2 Implement Unified MCP Handler (SSE + Streamable HTTP)

The `mcp-handler` package provides a **single handler** that supports both transports via the dynamic `[transport]` route.

**`app/api/[transport]/route.ts`:**

```typescript
import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { z } from 'zod';
import { NEON_TOOLS, NEON_HANDLERS } from '@/tools';
import { verifyToken } from '@/oauth/verify';
import { createNeonClient } from '@/server/api';

export const maxDuration = 800; // 13+ minutes with Fluid Compute

const handler = createMcpHandler(
  (server, extra) => {
    // Register all Neon tools
    for (const tool of NEON_TOOLS) {
      server.tool(
        tool.name,
        tool.description,
        tool.inputSchema,
        async (args, toolExtra) => {
          // Create Neon client from auth context
          const neonClient = createNeonClient(toolExtra.authInfo);
          const toolHandler = NEON_HANDLERS[tool.name];
          return toolHandler(args, neonClient, {
            ...toolExtra,
            authInfo: toolExtra.authInfo,
          });
        },
      );
    }
  },
  {
    serverInfo: {
      name: 'neon-mcp-server',
      version: '0.1.0',
    },
    capabilities: {
      tools: {},
      resources: {},
    },
  },
  {
    // Redis enables SSE transport with session persistence
    redisUrl: process.env.UPSTASH_REDIS_REST_URL,
    basePath: '/api',
    maxDuration: 800, // Fluid Compute
    verboseLogs: process.env.NODE_ENV !== 'production',
  },
);

// Token verification function for OAuth
const verifyTokenHandler = async (
  req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> => {
  if (!bearerToken) return undefined;

  // Try OAuth token first
  const oauthResult = await verifyOAuthToken(bearerToken);
  if (oauthResult) return oauthResult;

  // Fallback to Neon API key validation
  const apiKeyResult = await verifyApiKey(bearerToken);
  return apiKeyResult;
};

const authHandler = withMcpAuth(handler, verifyTokenHandler, {
  required: false, // Allow both OAuth and API key auth
  resourceMetadataPath: '/.well-known/oauth-protected-resource',
});

// IMPORTANT: Export GET, POST, and DELETE for full transport support
export { authHandler as GET, authHandler as POST, authHandler as DELETE };
```

**How it works:**

- **GET /api/sse** → SSE transport (long-lived connection with Redis session)
- **POST /api/mcp** → Streamable HTTP transport (stateless request/response)
- **DELETE /api/sse** → SSE session cleanup

**Key Configuration:**

- `redisUrl` enables SSE transport; without it, only Streamable HTTP works
- `basePath` must match the route location (e.g., `/api`)
- `maxDuration: 800` requires Fluid Compute on Vercel Pro

#### 1.3 Add Protected Resource Metadata

Required for OAuth-compliant MCP servers.

**`app/.well-known/oauth-protected-resource/route.ts`:**

```typescript
import {
  protectedResourceHandler,
  metadataCorsOptionsRequestHandler,
} from 'mcp-handler';

const handler = protectedResourceHandler({
  authServerUrls: [process.env.UPSTREAM_OAUTH_HOST!],
});

const corsHandler = metadataCorsOptionsRequestHandler();

export { handler as GET, corsHandler as OPTIONS };
```

This endpoint tells MCP clients where to authenticate and what the MCP server URL is.

**Redis Data Structure (automatic):**

```typescript
// mcp-handler manages this internally
// Sessions stored with key: "mcp-session:{sessionId}"
// TTL managed automatically based on activity
```

**Key Considerations for SSE:**

- Session state is managed automatically by `mcp-handler` + Redis
- No manual session map needed (unlike current Express implementation)
- Redis TTL handles cleanup of abandoned sessions
- Vercel Fluid Compute provides up to 800s timeout

#### 1.4 Database Connection Strategy

**Keep Postgres for OAuth, Add Redis for SSE**

The existing Postgres database continues to store all OAuth data. We only need to add Redis for SSE session management (required by `mcp-handler`).

**Option A: Keep @keyv/postgres (minimal change)**

If using Vercel Node.js Serverless Functions (not Edge), Keyv can continue working with some adjustments:

```typescript
// src/oauth/kv-store.ts (existing, keep as-is)
import Keyv from 'keyv';
import KeyvPostgres from '@keyv/postgres';

// Existing Keyv setup continues to work
export const kvStore = new Keyv({
  store: new KeyvPostgres({
    uri: process.env.OAUTH_DATABASE_URL,
  }),
});
```

**Option B: Upgrade to @neondatabase/serverless (recommended for Edge)**

For better cold-start performance and Edge runtime compatibility:

**`src/oauth/db.ts` (alternative):**

```typescript
import { neon, neonConfig } from '@neondatabase/serverless';

neonConfig.fetchConnectionCache = true; // Enable connection pooling

export const sql = neon(process.env.OAUTH_DATABASE_URL!);

// Example query
export async function getClient(clientId: string) {
  const result = await sql`
    SELECT * FROM mcpauth.clients WHERE client_id = ${clientId}
  `;
  return result[0];
}
```

**Recommendation:** Start with Option A (keep existing Keyv) for minimal migration risk, then evaluate Option B if cold-start latency is an issue.

**Connection Pool Benefits with @neondatabase/serverless:**

- HTTP-based queries (no TCP connection overhead)
- Automatic connection reuse via fetch cache
- Works in Edge and Serverless runtimes
- No connection limit concerns

### Phase 2: OAuth System Migration

#### 2.1 OAuth Routes Structure

**`app/api/authorize/route.ts`:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { validateClient, createAuthorizationUrl } from '@/oauth/authorize';

export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams);

  // Validate client and PKCE
  const validation = await validateClient(params);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  // Check approval cookie
  const approved = checkApprovalCookie(request, params.client_id);
  if (!approved) {
    return renderApprovalDialog(params);
  }

  // Redirect to upstream OAuth
  const authUrl = createAuthorizationUrl(params);
  return NextResponse.redirect(authUrl);
}

export async function POST(request: NextRequest) {
  // Handle approval form submission
  const formData = await request.formData();
  // ... set cookie, redirect to upstream
}
```

**`app/api/callback/route.ts`:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode, createAuthorizationCode } from '@/oauth/callback';

export async function GET(request: NextRequest) {
  const { code, state } = Object.fromEntries(request.nextUrl.searchParams);

  // Exchange upstream code for tokens
  const tokens = await exchangeCode(code);

  // Create downstream authorization code
  const authCode = await createAuthorizationCode(state, tokens);

  // Redirect to client
  const redirectUri = decodeState(state).redirect_uri;
  return NextResponse.redirect(`${redirectUri}?code=${authCode}`);
}
```

**`app/api/token/route.ts`:**

```typescript
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const body = await request.formData();
  const grantType = body.get('grant_type');

  if (grantType === 'authorization_code') {
    return handleAuthorizationCode(body);
  } else if (grantType === 'refresh_token') {
    return handleRefreshToken(body);
  }

  return NextResponse.json(
    { error: 'unsupported_grant_type' },
    { status: 400 },
  );
}
```

#### 2.2 Cookie Configuration for Vercel

**`src/oauth/cookies.ts` (updated):**

```typescript
import { cookies } from 'next/headers';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 60 * 60 * 24 * 365, // 1 year
  path: '/',
  domain: process.env.COOKIE_DOMAIN, // Set for production
};

export async function setApprovalCookie(clientId: string) {
  const cookieStore = await cookies();
  const approved = JSON.parse(
    cookieStore.get('approved-mcp-clients')?.value || '[]',
  );
  approved.push(clientId);
  cookieStore.set(
    'approved-mcp-clients',
    JSON.stringify(approved),
    COOKIE_OPTIONS,
  );
}
```

### Phase 3: Landing Page Integration

#### 3.1 Move Landing Page to App Router

**Option A: Integrate into Vercel deployment (recommended)**

Move `landing/` content to `app/` directory:

- `landing/src/app/page.tsx` → `app/page.tsx`
- `landing/src/components/` → `components/`
- `landing/src/lib/` → `lib/`

**Option B: Separate Vercel project**

Keep `landing/` as separate Next.js deployment with different domain.

#### 3.2 Tools JSON Generation

Update build script to generate `public/tools.json` for landing page:

```json
// package.json
{
  "scripts": {
    "build": "tsc && node scripts/export-tools.js",
    "build:vercel": "next build"
  }
}
```

### Phase 4: Environment Configuration

#### 4.1 Environment Variables

**Required for Production:**

| Variable              | Description                     | Example                            |
| --------------------- | ------------------------------- | ---------------------------------- |
| `OAUTH_DATABASE_URL`  | Neon Postgres connection string | `postgresql://user:pass@host/db`   |
| `COOKIE_SECRET`       | HMAC signing key for cookies    | `your-256-bit-secret`              |
| `CLIENT_ID`           | OAuth client ID for Neon        | `neon-mcp-server`                  |
| `CLIENT_SECRET`       | OAuth client secret             | `secret-value`                     |
| `SERVER_HOST`         | Public URL of this server       | `https://mcp.neon.tech`            |
| `UPSTREAM_OAUTH_HOST` | Neon OAuth provider URL         | `https://oauth2.neon.tech`         |
| `NEON_API_HOST`       | Neon API URL                    | `https://console.neon.tech/api/v2` |
| `ANALYTICS_WRITE_KEY` | Segment write key               | `abc123`                           |
| `SENTRY_DSN`          | Sentry error tracking DSN       | `https://...@sentry.io/...`        |

**Required for SSE Support:**

| Variable                   | Description            | Example                  |
| -------------------------- | ---------------------- | ------------------------ |
| `UPSTASH_REDIS_REST_URL`   | Upstash Redis REST URL | `https://xxx.upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis token    | `AXxx...`                |

**Optional:**

| Variable        | Description         | Default       |
| --------------- | ------------------- | ------------- |
| `LOG_LEVEL`     | Logging verbosity   | `info`        |
| `COOKIE_DOMAIN` | Cookie domain scope | Auto-detected |

**Note on Redis:**

- Use Upstash Redis (Vercel integration available) for SSE session persistence
- Alternative: Vercel KV (built on Upstash)
- Redis is REQUIRED for SSE transport; without it, only Streamable HTTP works

#### 4.2 Preview Deployment Configuration

For preview deployments (PR branches):

- Use `VERCEL_URL` environment variable for `SERVER_HOST`
- Share production database (read-only OAuth data)
- Use separate OAuth client for testing

```typescript
// lib/config.ts
export const SERVER_HOST =
  process.env.SERVER_HOST || `https://${process.env.VERCEL_URL}`;
```

### Phase 5: Migration & Cutover

#### 5.1 Parallel Deployment (Blue-Green)

1. Deploy to Vercel without DNS cutover
2. Test all flows against Vercel deployment
3. Configure production domain in Vercel
4. Update DNS to point to Vercel
5. Keep Koyeb running for 30-day deprecation period

#### 5.2 Rollback Procedure

If issues arise:

1. Revert DNS to Koyeb
2. Fix issues in Vercel deployment
3. Re-test and retry cutover

## Acceptance Criteria

### Functional Requirements

- [ ] Streamable HTTP transport works with MCP clients (Claude Desktop, Cursor, etc.)
- [ ] SSE transport works with legacy MCP clients (with Redis persistence)
- [ ] SSE sessions survive across serverless function invocations
- [ ] All 35+ MCP tools execute successfully via both transports
- [ ] OAuth authorization flow completes end-to-end
- [ ] Token refresh works correctly
- [ ] Client registration creates valid credentials
- [ ] OAuth metadata endpoint returns correct URLs
- [ ] Landing page displays all tools and documentation
- [ ] Health check endpoint returns 200 OK

### Non-Functional Requirements

- [ ] Cold start latency < 2 seconds
- [ ] Tool execution within 800s timeout (Fluid Compute)
- [ ] SSE connections stable for up to 800s
- [ ] Database connections use HTTP pooling
- [ ] Sentry captures errors with full context
- [ ] Analytics events are flushed before function exit
- [ ] CORS configured for legitimate origins only

### Quality Gates

- [ ] All existing Braintrust evaluations pass
- [ ] Manual testing of OAuth flow in staging
- [ ] Load testing with 100 concurrent requests
- [ ] Security review of cookie and token handling
- [ ] Documentation updated with Vercel-specific instructions

## Success Metrics

| Metric             | Target | Measurement            |
| ------------------ | ------ | ---------------------- |
| Deployment Success | 100%   | Vercel dashboard       |
| Cold Start P95     | < 2s   | Vercel Analytics       |
| Tool Success Rate  | > 99%  | Braintrust evaluations |
| OAuth Flow Success | > 99%  | Segment analytics      |
| Error Rate         | < 1%   | Sentry dashboard       |

## Dependencies & Prerequisites

**Before Starting:**

- [ ] Vercel Pro account (for Fluid Compute with 800s timeout)
- [ ] Neon Postgres database for OAuth (existing)
- [ ] Upstash Redis account for SSE session pub/sub
- [ ] Domain configured in Vercel (existing or new)
- [ ] Environment variables configured in Vercel dashboard

**New Dependencies to Add:**

```bash
npm install mcp-handler @modelcontextprotocol/sdk zod@^3
npm install @upstash/redis
```

- `mcp-handler` - Vercel's official MCP handler (replaces custom Express routes)
- `@modelcontextprotocol/sdk` - MCP SDK (peer dependency)
- `zod@^3` - Schema validation (peer dependency)
- `@upstash/redis` - Redis client for SSE session pub/sub

**Existing Dependencies to Keep:**

- `keyv` + `@keyv/postgres` - Continue using for OAuth data storage
- Existing OAuth infrastructure remains unchanged

## Risk Analysis & Mitigation

| Risk                           | Impact | Probability | Mitigation                                                                       |
| ------------------------------ | ------ | ----------- | -------------------------------------------------------------------------------- |
| SSE operations exceed 800s     | Medium | Low         | Fluid Compute provides 800s; document as limit, most operations complete in <60s |
| SSE cross-instance routing     | Medium | Low         | Fluid Compute instance reuse minimizes this; add Redis if needed                 |
| Database connection exhaustion | Medium | Low         | Fluid Compute reuses connections; use Neon pooling URL if issues                 |
| Cold start latency too high    | Medium | Low         | Fluid Compute keeps instances warm; lazy load if needed                          |
| OAuth flow state lost          | High   | Low         | State encoded in URL params, DB-backed                                           |
| Cookie domain issues           | Medium | Medium      | Test on preview deployments first                                                |
| Instance restart during SSE    | Medium | Medium      | Graceful reconnection logic in client; consider Redis if frequent                |
| Fluid Compute costs            | Low    | Low         | ~90% savings reported vs standard serverless                                     |

## Implementation Phases

### Phase 1: Core Migration (Week 1-2)

- [ ] Create Vercel project structure (Next.js App Router)
- [ ] Enable Fluid Compute in Vercel project settings
- [ ] Set up Upstash Redis via Vercel Marketplace
- [ ] Implement unified MCP handler with `mcp-handler` + Redis
- [ ] Port OAuth routes to App Router (authorization, callback, token, register)
- [ ] Keep existing Keyv/Postgres for OAuth (no changes needed)
- [ ] Deploy to Vercel preview (not production domain)
- [ ] Test both Streamable HTTP and SSE transports
- [ ] Verify tool execution and OAuth flow

### Phase 2: Landing Page & Polish (Week 2-3)

- [ ] Migrate landing page to Vercel
- [ ] Add health check endpoint
- [ ] Configure Sentry and Analytics
- [ ] Update cookie handling for Vercel domain
- [ ] Documentation updates

### Phase 3: Cutover & Monitor (Week 3-4)

- [ ] Final testing on preview deployment
- [ ] DNS cutover to Vercel
- [ ] Monitor SSE session stability and Redis performance
- [ ] Keep Koyeb available for 7-day rollback window
- [ ] Remove Koyeb deployment after validation

**Simplified from 5 phases to 3** - Fluid Compute + Redis from day 1 ensures robust SSE support.

## Client Configuration

After deployment, clients can connect to the MCP server using these configurations:

### Direct HTTP/SSE (Recommended for newer clients)

```json
{
  "mcpServers": {
    "neon": {
      "url": "https://mcp.neon.tech/api/mcp"
    }
  }
}
```

### Stdio Bridge (For legacy clients like Claude Desktop)

Clients that only support stdio can use `mcp-remote` as a proxy:

```json
{
  "mcpServers": {
    "neon": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.neon.tech/api/mcp"]
    }
  }
}
```

### Client-Specific Locations

| Client                   | Config File Location                                              |
| ------------------------ | ----------------------------------------------------------------- |
| Claude Desktop (macOS)   | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json`                     |
| Cursor                   | `~/.cursor/mcp.json`                                              |
| Windsurf                 | `~/.codeium/windsurf/mcp_config.json`                             |

## Future Considerations

- **Edge Functions**: Once OAuth stabilizes, consider Edge runtime for faster cold starts
- **Vercel KV**: Replace Postgres for OAuth tokens if latency becomes an issue
- **Multi-region**: Deploy to multiple regions for lower latency
- **Caching**: Add response caching for frequently accessed metadata

## References & Research

### Internal References

- Current SSE transport: `src/transports/sse-express.ts`
- Current Stream transport: `src/transports/stream.ts`
- OAuth server: `src/oauth/server.ts`
- Keyv store: `src/oauth/kv-store.ts`
- Tool definitions: `src/tools/definitions.ts`
- Koyeb config: `.github/workflows/koyeb-prod.yml`

### External References

- [Vercel MCP Documentation](https://vercel.com/docs/mcp)
- [Deploy MCP Servers to Vercel](https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel)
- [Building Efficient MCP Servers](https://vercel.com/blog/building-efficient-mcp-servers)
- [@vercel/mcp-handler](https://github.com/vercel/mcp-handler)
- [Vercel Functions Streaming](https://vercel.com/docs/functions/streaming-functions)
- [Neon Serverless Driver](https://neon.tech/docs/serverless/serverless-driver)
- [MCP Specification - Streamable HTTP](https://modelcontextprotocol.io/docs/concepts/transports)

### Related Work

- [Neon Blog: MCP with Vercel and Better Auth](https://neon.com/blog/solving-mcp-with-vercel-and-better-auth)
- [Vapi MCP Server on Vercel](https://vercel.com/blog/vapi-mcp-server-on-vercel)

---

_Plan created: 2025-12-17_
_Author: Claude Code Assistant_
