# Neon MCP Server - Landing & Remote Server

This directory contains:
1. **Landing Page**: Marketing site for the Neon MCP Server
2. **Remote MCP Server**: Vercel-hosted serverless MCP server accessible at `mcp.neon.tech`

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

## Environment Variables

Required for the remote MCP server:

| Variable | Description |
|----------|-------------|
| `SERVER_HOST` | Server URL (defaults to `VERCEL_URL`) |
| `UPSTREAM_OAUTH_HOST` | Neon OAuth provider URL |
| `CLIENT_ID` | OAuth client ID |
| `CLIENT_SECRET` | OAuth client secret |
| `COOKIE_SECRET` | Secret for signed cookies |
| `KV_URL` | Vercel KV (Upstash Redis) URL |
| `OAUTH_DATABASE_URL` | Postgres URL for token storage |

## Deployment

The server is automatically deployed to Vercel on push to the main branch. Preview deployments are created for pull requests.

See `vercel-migration.md` for detailed migration documentation from the previous Express-based deployment.
