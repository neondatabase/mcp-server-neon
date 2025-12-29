# CLAUDE.md

This file provides guidance to AI agents when working with code in this repository.

## Project Overview

This is the **Neon MCP Server** - a Model Context Protocol server that bridges natural language requests to the Neon API, enabling LLMs to manage Neon Postgres databases through conversational commands. The project implements both local (stdio) and remote (SSE/Streamable HTTP) MCP server transports with OAuth authentication support.

**Architecture Note**: The project has two server implementations:
1. **Local MCP Server** (`src/`): Runs locally via stdio transport, published as `@neondatabase/mcp-server-neon` npm package
2. **Remote MCP Server** (`landing/`): Deployed on Vercel serverless infrastructure, accessible at `mcp.neon.tech`

## Development Commands

### Building and Running

```bash
# Install dependencies
npm install

# Build the project (compiles TypeScript and builds landing page)
npm run build

# Watch mode for development (auto-recompiles on changes)
npm run watch

# Type checking without emitting files
npm run typecheck

# Start local MCP server with API key
node dist/index.js start <NEON_API_KEY>

# Start SSE transport server
node dist/index.js start:sse
```

### Development with MCP CLI Client

The fastest way to iterate on the MCP Server is using the `mcp-client/` CLI:

```bash
npm install
npm run build
npm run watch  # Keep this running in one terminal
cd mcp-client/ && NEON_API_KEY=<your-key> npm run start:mcp-server-neon
```

This provides an interactive terminal to test MCP tools without restarting Claude Desktop.

### Testing

```bash
# Run Braintrust evaluations
npm run test

# You must configure .env file with:
# - BRAINTRUST_API_KEY
# - NEON_API_KEY
# - ANTHROPIC_API_KEY
```

### Linting and Formatting

```bash
# Run linting and formatting checks
npm run lint

# Auto-fix linting and formatting issues
npm run lint:fix

# Format code
npm run format
```

### Single Test Development

To develop and test a single tool without running full test suite, modify the test file in `src/tools-evaluations/` and run:

```bash
npm run test
```

## Architecture

### Core Components

1. **MCP Server (`src/server/index.ts`)**

   - Creates and configures the MCP server instance
   - Registers all tools and resources from centralized definitions
   - Implements error handling and observability (Sentry, analytics)
   - Each tool call is tracked and wrapped in error handling

2. **Tools System (`src/tools/`)**

   - `definitions.ts`: Exports `NEON_TOOLS` array defining all available tools with their schemas
   - `tools.ts`: Exports `NEON_HANDLERS` object mapping tool names to handler functions
   - `toolsSchema.ts`: Zod schemas for tool input validation
   - `handlers/`: Individual tool handler implementations organized by feature

3. **Transport Layers (`src/transports/`)**

   - `stdio.ts`: Standard input/output transport for local MCP clients (Claude Desktop, Cursor)
   - `sse-express.ts`: Server-Sent Events transport (legacy, used for local development)
   - `stream.ts`: Streamable HTTP transport (legacy, used for local development)

   **Note**: The remote MCP server transports are now handled by Vercel serverless functions in `landing/app/api/`.

4. **OAuth System (`src/oauth/`)**

   - OAuth 2.0 server implementation for remote MCP authentication
   - Integrates with Neon's OAuth provider (UPSTREAM_OAUTH_HOST)
   - Token persistence using Keyv with Postgres backend
   - Cookie-based client approval tracking

5. **Resources (`src/resources.ts`)**
   - MCP resources that provide read-only context (like "getting started" guides)
   - Registered alongside tools but don't execute operations

### Key Architectural Patterns

- **Tool Registration Pattern**: All tools are defined in `NEON_TOOLS` array and handlers in `NEON_HANDLERS` object. The server iterates through tools and registers them with their corresponding handlers.

- **Error Handling**: Tools throw errors which are caught by the server wrapper, logged to Sentry, and returned as structured error messages to the LLM.

- **State Management**: Some tools (migrations, query tuning) create temporary branches and maintain state across multiple tool calls. The LLM is prompted to remember branch IDs from previous calls.

- **Analytics & Observability**: Every tool call, resource access, and error is tracked through Segment analytics and Sentry error reporting.

## Adding New Tools

1. Define the tool schema in `src/tools/toolsSchema.ts`:

```typescript
export const myNewToolInputSchema = z.object({
  project_id: z.string().describe('The Neon project ID'),
  // ... other fields
});
```

2. Add the tool definition to `NEON_TOOLS` array in `src/tools/definitions.ts`:

```typescript
{
  name: 'my_new_tool' as const,
  description: 'Description of what this tool does',
  inputSchema: myNewToolInputSchema,
}
```

3. Create a handler in `src/tools/handlers/my-new-tool.ts`:

```typescript
import { ToolHandler } from '../types.js';
import { myNewToolInputSchema } from '../toolsSchema.js';

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

4. Register the handler in `src/tools/tools.ts`:

```typescript
import { myNewToolHandler } from './handlers/my-new-tool.js';

export const NEON_HANDLERS = {
  // ... existing handlers
  my_new_tool: myNewToolHandler,
};
```

5. Add evaluations in `src/tools-evaluations/` to test your tool.

## Environment Configuration

See `.env.example` for all configuration options. Key variables:

- `NEON_API_KEY`: Required for local development and testing
- `BRAINTRUST_API_KEY`: Required for running evaluations
- `ANTHROPIC_API_KEY`: Required for running evaluations
- `OAUTH_DATABASE_URL`: Required for remote MCP server with OAuth
- `COOKIE_SECRET`: Required for remote MCP server OAuth flow
- `CLIENT_ID` / `CLIENT_SECRET`: OAuth client credentials

## Project Structure

```
src/
├── index.ts                 # Entry point, command parser, transport selection
├── server/
│   ├── index.ts            # MCP server creation and tool/resource registration
│   └── api.ts              # Neon API client factory
├── tools/
│   ├── definitions.ts      # Tool definitions (NEON_TOOLS)
│   ├── tools.ts           # Tool handlers mapping (NEON_HANDLERS)
│   ├── toolsSchema.ts     # Zod schemas for tool inputs
│   └── handlers/          # Individual tool implementations
├── transports/
│   ├── stdio.ts           # Local MCP transport
│   ├── sse-express.ts     # Remote SSE transport
│   └── stream.ts          # Remote Streamable HTTP transport
├── oauth/                 # OAuth 2.0 implementation
├── analytics/             # Segment analytics integration
├── sentry/               # Sentry error tracking
└── utils/                # Shared utilities

mcp-client/               # CLI client for testing
landing/                  # Next.js app with remote MCP server
├── app/                 # Next.js App Router
│   ├── api/            # API routes for remote MCP server
│   │   ├── [transport]/route.ts  # Main MCP handler (SSE/Streamable HTTP)
│   │   ├── authorize/  # OAuth authorization endpoint
│   │   ├── callback/   # OAuth callback handler
│   │   ├── token/      # OAuth token exchange
│   │   ├── register/   # Dynamic client registration
│   │   └── health/     # Health check endpoint
│   └── .well-known/    # OAuth discovery endpoints
├── lib/                # Next.js-compatible utilities
│   ├── config.ts       # Centralized configuration
│   └── oauth/          # OAuth utilities for Next.js
├── mcp-src/            # MCP server code (shared with src/)
│   ├── server/        # MCP server factory
│   ├── tools/         # Tool definitions and handlers
│   ├── oauth/         # OAuth model and KV store
│   └── analytics/     # Segment analytics
└── vercel.json        # Vercel deployment config
```

## Important Notes

- **TypeScript Configuration**:
  - `src/`: Uses ES2022 with Node16 module resolution. All imports must use `.js` extensions (not `.ts`) due to ESM requirements.
  - `landing/mcp-src/`: Uses `bundler` module resolution for Next.js compatibility. Imports use extensionless paths.

- **Building**: The build process includes chmod operations to make `dist/index.js` executable, exports tool definitions to `landing/tools.json`, and builds the landing page.

- **Logger Behavior**: In stdio mode, the logger is silenced to prevent stderr pollution. In SSE mode, logging is active.

- **Migration Pattern**: Tools like `prepare_database_migration` and `prepare_query_tuning` create temporary branches. The LLM must remember these branch IDs to pass to subsequent `complete_*` tools.

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
| `/api/callback` | OAuth callback handler |
| `/api/token` | OAuth token exchange |
| `/api/register` | Dynamic client registration |
| `/.well-known/oauth-authorization-server` | OAuth server metadata |
| `/.well-known/oauth-protected-resource` | OAuth protected resource metadata |

### Environment Variables (Vercel)

| Variable | Description |
|----------|-------------|
| `SERVER_HOST` | Server URL (falls back to `VERCEL_BRANCH_URL` or `VERCEL_URL`) |
| `UPSTREAM_OAUTH_HOST` | Neon OAuth provider URL |
| `CLIENT_ID` / `CLIENT_SECRET` | OAuth client credentials |
| `COOKIE_SECRET` | Secret for signed cookies |
| `KV_URL` | Vercel KV (Upstash Redis) URL |
| `OAUTH_DATABASE_URL` | Postgres URL for token storage |
| `SENTRY_DSN` | Sentry error tracking DSN |
| `ANALYTICS_WRITE_KEY` | Segment analytics write key |

### Development Notes

- The `landing/mcp-src/` directory contains a copy of the MCP server code adapted for Vercel's bundler
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

- **Severity**: 🔴 Critical | 🟡 Important | 🔵 Consider
- **Category**: [Security/Logic/Performance/Architecture/Testing/MCP]
- **Description**: Clear explanation with context
- **Fix**: Actionable code example or reference

Example:

```
🔴 **[Security]**: SQL injection vulnerability - user input concatenated directly into SQL.

**Fix:** Use parameterized queries:
const result = await query('SELECT * FROM users WHERE name = $1', [userName]);
```

### Triggering Reviews

- **Automatic**: Opens when PR is created
- **Manual**: Run workflow via GitHub Actions with PR number
- **Security**: Only OWNER/MEMBER/COLLABORATOR PRs (blocks external)

## Testing Strategy

Tests use Braintrust for LLM-based evaluations. Each test:

1. Defines a task/prompt
2. Executes it against the MCP server
3. Evaluates the result using Braintrust scoring functions

This validates that tools work correctly with realistic LLM interactions.
