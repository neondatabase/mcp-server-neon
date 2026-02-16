# Neon MCP Server - Remote Server

This directory contains the **Remote MCP Server**: a Vercel-hosted serverless MCP server accessible at `mcp.neon.tech`.

> **Note:** The root `/` path redirects to the [Neon MCP Server documentation](https://neon.tech/docs/ai/neon-mcp-server). There is no landing page.

## Architecture

The remote MCP server is deployed on Vercel's serverless infrastructure using Next.js App Router.

### Key Components

- **`app/api/[transport]/route.ts`**: Main MCP handler supporting both SSE and Streamable HTTP transports
- **`app/api/authorize/`, `callback/`, `token/`, `revoke/`**: OAuth 2.0 flow endpoints
- **`app/.well-known/`**: OAuth discovery endpoints (includes `scopes_supported` metadata)
- **`mcp-src/`**: MCP server implementation adapted for Vercel's bundler
- **`mcp-src/utils/read-only.ts`**: Read-only mode detection and scope definitions
- **`mcp-src/utils/trace.ts`**: TraceId generation for request correlation across logs and errors
- **`lib/`**: Next.js-compatible utilities (config, OAuth)
- **`lib/oauth/redirect-uri.ts`**: RFC 8252 loopback redirect URI matching (localhost/127.0.0.1/::1 equivalence)

### Read-Only Mode

The server supports read-only mode to restrict available tools. Priority for determining read-only status:

1. **`X-READ-ONLY` header**: Explicit override (`true`/`false`)
2. **OAuth scope**: If token has only `read` scope (no `write` or `*`), read-only is enabled
3. **Default**: Read-write access

### OAuth Scopes

Available scopes: `read`, `write`, `*`

During OAuth authorization, users see a permissions dialog where they can:

- **Read-only**: Always granted (view projects, run queries)
- **Full access**: Optional checkbox (create/delete resources, migrations)

The `/.well-known/oauth-authorization-server` endpoint exposes `scopes_supported` for client discovery.

## Development

```bash
# Install dependencies
bun install

# Run development server
bun dev

# Build for production
bun run build
```

## Testing Pyramid

This repository follows an explicit testing pyramid:

1. **E2E first**: validate user-visible behavior and MCP protocol integration.
2. **Integration second**: validate tool contracts and cross-tool workflows without external dependencies.
3. **Unit last**: validate edge-case logic and invariants quickly.

### Test Tiers

- **Website E2E (Playwright)**: tests in `e2e/` (HTTP endpoints, OAuth discovery, routing).
- **MCP E2E (Vitest + MCP protocol)**: tests in `mcp-src/__tests__/*.e2e.test.ts`, using an MCP client and in-memory transport to perform real tool calls.
- **Integration (Vitest)**: tests in `mcp-src/__tests__/*.integration.test.ts`, using deterministic mocks for external systems.
- **Unit (Vitest)**: tests in `mcp-src/__tests__/*.test.ts` (excluding integration/e2e files).

### Commands

```bash
# Unit only
bun run test:unit

# Integration only
bun run test:integration

# MCP protocol e2e only
bun run test:e2e:mcp

# Website e2e only
bun run test:e2e:web

# All e2e
bun run test:e2e

# Full pyramid (used in CI before merge)
bun run test:all
```

### Rules for New Tests

- Prefer E2E tests when behavior crosses transport/protocol boundaries.
- Do not make third-party availability a merge blocker; use integration mocks for external systems.
- Add integration tests for tool contracts (inputs, outputs, error mapping).
- Add unit tests for pure logic, validation, and edge cases.

## Environment Variables

Required for the remote MCP server:

| Variable              | Description                           |
| --------------------- | ------------------------------------- |
| `SERVER_HOST`         | Server URL (defaults to `VERCEL_URL`) |
| `UPSTREAM_OAUTH_HOST` | Neon OAuth provider URL               |
| `CLIENT_ID`           | OAuth client ID                       |
| `CLIENT_SECRET`       | OAuth client secret                   |
| `COOKIE_SECRET`       | Secret for signed cookies             |
| `KV_URL`              | Vercel KV (Upstash Redis) URL         |
| `OAUTH_DATABASE_URL`  | Postgres URL for token storage        |

Optional:

| Variable    | Description                                                                       |
| ----------- | --------------------------------------------------------------------------------- |
| `LOG_LEVEL` | Winston log level: `error`, `warn`, `info` (default), `debug`, `verbose`, `silly` |

## Deployment

The server is automatically deployed to Vercel on push to the main branch. Preview deployments are created for pull requests.

See `vercel-migration.md` for detailed migration documentation from the previous Express-based deployment.
