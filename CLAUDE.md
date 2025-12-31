# CLAUDE.md

This file provides guidance to AI agents when working with code in this repository.

## Project Overview

This is the **Neon MCP Server** - a Model Context Protocol server that bridges natural language requests to the Neon API, enabling LLMs to manage Neon Postgres databases through conversational commands. The project implements both local (stdio) and remote (SSE/Streamable HTTP) MCP server transports with OAuth authentication support.

**Architecture Note**: The entire project is a unified Next.js application in the `landing/` directory that serves dual purposes:
1. **Remote MCP Server**: Deployed on Vercel serverless infrastructure, accessible at `mcp.neon.tech`
2. **Local MCP CLI**: Published as `@neondatabase/mcp-server-neon` npm package, runs locally via stdio transport

## Development Commands

All commands should be run from the `landing/` directory. The project uses [Bun](https://bun.sh) as the package manager.

### Building and Running

```bash
cd landing
bun install

# Start the Next.js dev server (for the remote MCP server)
bun run dev

# Build the CLI for local testing
bun run build:cli

# Run the CLI locally with API key
bun run start:cli $NEON_API_KEY

# Or run the built CLI directly
node dist/cli/cli.js start <NEON_API_KEY>
```

### Development with MCP CLI Client

The fastest way to iterate on the MCP Server is using the `mcp-client/` CLI:

```bash
cd landing && bun install && bun run build:cli
cd ../mcp-client && NEON_API_KEY=<your-key> npm run start:mcp-server-neon
```

This provides an interactive terminal to test MCP tools without restarting Claude Desktop.

### Linting and Type Checking

```bash
cd landing
bun run lint
bun run typecheck
```

## Architecture

### Core Components

1. **MCP Server (`landing/mcp-src/server/index.ts`)**

   - Creates and configures the MCP server instance
   - Registers all tools and resources from centralized definitions
   - Implements error handling and observability (Sentry, analytics)
   - Each tool call is tracked and wrapped in error handling

2. **Tools System (`landing/mcp-src/tools/`)**

   - `definitions.ts`: Exports `NEON_TOOLS` array defining all available tools with their schemas
   - `tools.ts`: Exports `NEON_HANDLERS` object mapping tool names to handler functions
   - `toolsSchema.ts`: Zod schemas for tool input validation
   - `handlers/`: Individual tool handler implementations organized by feature

3. **CLI Entry Point (`landing/mcp-src/cli.ts`)**

   - Entry point for the npm package CLI
   - Handles stdio transport for local MCP clients (Claude Desktop, Cursor)

4. **Remote Transport (`landing/app/api/[transport]/route.ts`)**

   - Next.js API route handling SSE and Streamable HTTP transports
   - Uses `mcp-handler` library for serverless MCP protocol handling

5. **OAuth System (`landing/lib/oauth/` and `landing/mcp-src/oauth/`)**

   - OAuth 2.0 server implementation for remote MCP authentication
   - Integrates with Neon's OAuth provider (UPSTREAM_OAUTH_HOST)
   - Token persistence using Keyv with Postgres backend
   - Cookie-based client approval tracking

6. **Resources (`landing/mcp-src/resources.ts`)**
   - MCP resources that provide read-only context (like "getting started" guides)
   - Registered alongside tools but don't execute operations

### Key Architectural Patterns

- **Tool Registration Pattern**: All tools are defined in `NEON_TOOLS` array and handlers in `NEON_HANDLERS` object. The server iterates through tools and registers them with their corresponding handlers.

- **Error Handling**: Tools throw errors which are caught by the server wrapper, logged to Sentry, and returned as structured error messages to the LLM.

- **Stateless Design**: The server is designed for serverless deployment. Tools like migrations and query tuning create temporary branches but do NOT store state in memory. Instead, all context (branch IDs, migration SQL, etc.) is returned to the LLM, which passes it back to subsequent tool calls. This enables horizontal scaling on Vercel.

- **Read-Only Mode**: Tools define a `readOnlySafe` property. When the server runs in read-only mode, only tools marked as `readOnlySafe: true` are available.

- **MCP Tool Annotations**: All tools include MCP-standard annotations for client hints:
  - `title`: Human-readable tool name
  - `readOnlyHint`: Whether the tool only reads data
  - `destructiveHint`: Whether the tool can cause irreversible changes
  - `idempotentHint`: Whether repeated calls produce the same result
  - `openWorldHint`: Whether the tool interacts with external systems

- **Analytics & Observability**: Every tool call, resource access, and error is tracked through Segment analytics and Sentry error reporting.

## Adding New Tools

1. Define the tool schema in `landing/mcp-src/tools/toolsSchema.ts`:

```typescript
export const myNewToolInputSchema = z.object({
  project_id: z.string().describe('The Neon project ID'),
  // ... other fields
});
```

2. Add the tool definition to `NEON_TOOLS` array in `landing/mcp-src/tools/definitions.ts`:

```typescript
{
  name: 'my_new_tool' as const,
  description: 'Description of what this tool does',
  inputSchema: myNewToolInputSchema,
  readOnlySafe: true, // Set to true if tool only reads data (for read-only mode filtering)
  annotations: {
    title: 'My New Tool',
    readOnlyHint: true,      // Does it only read data?
    destructiveHint: false,  // Can it cause irreversible changes?
    idempotentHint: true,    // Do repeated calls produce same result?
    openWorldHint: false,    // Does it interact with external systems?
  } satisfies ToolAnnotations,
}
```

3. Create a handler in `landing/mcp-src/tools/handlers/my-new-tool.ts`:

```typescript
import { ToolHandler } from '../types';
import { myNewToolInputSchema } from '../toolsSchema';

export const myNewToolHandler: ToolHandler<'my_new_tool'> = async (
  args,
  neonClient,
  extra,
) => {
  // Implementation
  return {
    content: [
      {
        type: 'text',
        text: 'Result message',
      },
    ],
  };
};
```

4. Register the handler in `landing/mcp-src/tools/tools.ts`:

```typescript
import { myNewToolHandler } from './handlers/my-new-tool';

export const NEON_HANDLERS = {
  // ... existing handlers
  my_new_tool: myNewToolHandler,
};
```

## Environment Configuration

See `landing/.env.local.example` for all configuration options. Key variables:

- `NEON_API_KEY`: Required for local development and testing
- `BRAINTRUST_API_KEY`: Required for running evaluations
- `ANTHROPIC_API_KEY`: Required for running evaluations
- `OAUTH_DATABASE_URL`: Required for remote MCP server with OAuth
- `COOKIE_SECRET`: Required for remote MCP server OAuth flow
- `CLIENT_ID` / `CLIENT_SECRET`: OAuth client credentials

## Project Structure

```
landing/                  # Next.js app (main project)
├── app/                 # Next.js App Router
│   ├── api/            # API routes for remote MCP server
│   │   ├── [transport]/route.ts  # Main MCP handler (SSE/Streamable HTTP)
│   │   ├── authorize/  # OAuth authorization endpoint
│   │   ├── token/      # OAuth token exchange
│   │   ├── register/   # Dynamic client registration
│   │   ├── revoke/     # OAuth token revocation
│   │   └── health/     # Health check endpoint
│   ├── callback/       # OAuth callback handler
│   └── .well-known/    # OAuth discovery endpoints
├── lib/                # Next.js-compatible utilities
│   ├── config.ts       # Centralized configuration
│   └── oauth/          # OAuth utilities for Next.js
├── mcp-src/            # MCP server source code
│   ├── cli.ts          # CLI entry point (stdio transport)
│   ├── server/         # MCP server factory
│   │   ├── index.ts    # Server creation and tool registration
│   │   ├── api.ts      # Neon API client factory
│   │   └── errors.ts   # Error handling utilities
│   ├── tools/          # Tool definitions and handlers
│   │   ├── definitions.ts  # Tool definitions (NEON_TOOLS) with annotations
│   │   ├── tools.ts       # Tool handlers mapping (NEON_HANDLERS)
│   │   ├── toolsSchema.ts # Zod schemas for tool inputs
│   │   ├── handlers/      # Individual tool implementations
│   │   ├── types.ts       # TypeScript types
│   │   └── utils.ts       # Tool utilities
│   ├── oauth/          # OAuth model and KV store
│   ├── analytics/      # Segment analytics
│   ├── sentry/         # Sentry error tracking
│   ├── transports/     # Transport implementations
│   │   └── stdio.ts    # Stdio transport for CLI
│   ├── types/          # Shared TypeScript types
│   ├── utils/          # Shared utilities
│   ├── resources.ts    # MCP resources
│   ├── prompts.ts      # LLM prompts
│   └── constants.ts    # Shared constants
├── components/         # React components for landing page
├── patches/            # npm package patches
├── public/             # Static assets
├── package.json        # Package configuration
├── tsconfig.json       # TypeScript config (bundler resolution)
├── vercel.json         # Vercel deployment config
└── vercel-migration.md # Migration documentation

mcp-client/             # CLI client for testing
```

## Important Notes

- **TypeScript Configuration**: Uses `bundler` module resolution for Next.js compatibility. Imports use extensionless paths (no `.js` suffix).

- **Building**: The CLI build uses esbuild to bundle `mcp-src/cli.ts` into a standalone executable at `dist/cli/cli.js`.

- **Logger Behavior**: In stdio mode, the logger is silenced to prevent stderr pollution. In server mode, logging is active.

- **Migration Pattern**: Tools like `prepare_database_migration` and `prepare_query_tuning` create temporary branches and return all context (branch IDs, SQL, database name, etc.) in the response. The LLM must pass this context back to subsequent `complete_*` tools. No state is stored server-side, enabling serverless deployment.

- **Neon API Client**: Created using `@neondatabase/api-client` package. All tool handlers receive a pre-configured `neonClient` instance.

## Remote MCP Server (Vercel)

The remote MCP server (`mcp.neon.tech`) is deployed on Vercel's serverless infrastructure.

### Key Technologies

- **Next.js App Router**: API routes handle MCP protocol and OAuth flow
- **mcp-handler library**: Abstracts MCP protocol complexity for serverless environments
- **Vercel Fluid Compute**: Supports up to 800s function duration for SSE connections
- **Upstash Redis**: Session storage via Vercel KV (`KV_URL` environment variable)
- **Postgres via Keyv**: Token persistence using `OAUTH_DATABASE_URL`

### API Endpoints

| Route | Purpose |
|-------|---------|
| `/api/mcp` | Streamable HTTP transport (recommended) |
| `/api/sse` | Server-Sent Events transport (deprecated) |
| `/api/authorize` | OAuth authorization initiation |
| `/callback` | OAuth callback handler |
| `/api/token` | OAuth token exchange |
| `/api/revoke` | OAuth token revocation |
| `/api/register` | Dynamic client registration |
| `/.well-known/oauth-authorization-server` | OAuth server metadata |
| `/.well-known/oauth-protected-resource` | OAuth protected resource metadata |

### Environment Variables (Vercel)

| Variable | Description |
|----------|-------------|
| `SERVER_HOST` | Server URL (falls back to `VERCEL_URL`) |
| `UPSTREAM_OAUTH_HOST` | Neon OAuth provider URL |
| `CLIENT_ID` / `CLIENT_SECRET` | OAuth client credentials |
| `COOKIE_SECRET` | Secret for signed cookies |
| `KV_URL` | Vercel KV (Upstash Redis) URL |
| `OAUTH_DATABASE_URL` | Postgres URL for token storage |
| `SENTRY_DSN` | Sentry error tracking DSN |
| `ANALYTICS_WRITE_KEY` | Segment analytics write key |

### Development Notes

- Import paths in `landing/mcp-src/` are extensionless (no `.js` suffix)
- The `mcp-handler` library has a patch (`landing/patches/mcp-handler+1.0.4.patch`) for compatibility fixes
- See `landing/vercel-migration.md` for detailed migration documentation

## Claude Code Review Workflow

This repository uses an enhanced Claude Code Review workflow that provides inline feedback on pull requests.

### What Gets Reviewed

- Architecture and design patterns (tool registration, handler typing)
- Security vulnerabilities (SQL injection, secrets, input validation)
- Logic bugs (error handling, state management, edge cases)
- Performance issues (N+1 queries, inefficient API usage)
- Testing gaps (missing evaluations, uncovered scenarios)
- MCP-specific patterns (analytics tracking, error handling, Sentry capture)

### What's Automated (Not Reviewed by Claude)

- Linting: `bun run lint` (checked by pr.yml)
- Building: `bun run build` (checked by pr.yml)
- Formatting: Automated formatting checks

### Review Process

1. Workflow triggers automatically on PR open
2. Claude analyzes changes with full project context
3. Inline comments posted on significant issues
4. Summary comment provides overview and statistics

### Inline Comment Format

- **Severity**: Critical | Important | Consider
- **Category**: [Security/Logic/Performance/Architecture/Testing/MCP]
- **Description**: Clear explanation with context
- **Fix**: Actionable code example or reference

### Triggering Reviews

- **Automatic**: Opens when PR is created
- **Manual**: Run workflow via GitHub Actions with PR number
- **Security**: Only OWNER/MEMBER/COLLABORATOR PRs (blocks external)
