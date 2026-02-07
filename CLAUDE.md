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

# Run the CLI with access control flags
bun run start:cli $NEON_API_KEY -- --preset local_development --project-id my-project --protect-production

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

   **Account Resolution (`landing/mcp-src/server/account.ts`)**:
   - Resolves user/org account info from Neon API auth details
   - Handles org accounts, personal accounts, and project-scoped API keys
   - Falls back gracefully when project-scoped keys cannot access account-level endpoints

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

- **Read-Only Mode** (`landing/mcp-src/utils/read-only.ts`): Tools define a `readOnlySafe` property. When the server runs in read-only mode, only tools marked as `readOnlySafe: true` are available. Read-only mode is determined by priority: `X-Neon-Read-Only` header > `x-read-only` header (legacy synonym) > grant preset (`production_use` = read-only) > OAuth scope (only `read` scope = read-only) > default (false). The module also exports `SCOPE_DEFINITIONS` for human-readable scope labels and `hasWriteScope()` to check for write permissions.

- **OAuth Authorization UI**: During OAuth authorization, users see a permissions dialog rendered by `landing/app/api/authorize/route.ts`. The UI presents **permission presets** as radio buttons (`full_access`, `local_development`, `production_use`) and a **"Protect production branches"** checkbox. The selected preset and protection settings are encoded into the grant context and forwarded through the OAuth flow. When a client has already been approved (tracked via signed cookies), the dialog is skipped.

- **MCP Tool Annotations**: All tools include MCP-standard annotations for client hints:
  - `title`: Human-readable tool name
  - `readOnlyHint`: Whether the tool only reads data
  - `destructiveHint`: Whether the tool can cause irreversible changes
  - `idempotentHint`: Whether repeated calls produce the same result
  - `openWorldHint`: Whether the tool interacts with external systems

- **Fine-Grained Access Control** (`landing/mcp-src/utils/grant-context.ts`, `landing/mcp-src/tools/grant-filter.ts`, `landing/mcp-src/tools/grant-enforcement.ts`): The server supports access control through permission presets, project scoping, production branch protection, and custom scope categories.
  - **Permission Presets**: `full_access` (default, no restrictions), `local_development` (no project create/delete), `production_use` (read-only), `custom` (select specific tool categories).
  - **Project Scoping**: Restricts all operations to a single Neon project. Project-agnostic tools are hidden and `projectId` is auto-injected into tool calls.
  - **Production Branch Protection**: Blocks destructive operations (`delete_branch`, `reset_from_parent`, `run_sql`, `run_sql_transaction`) on protected branches.
  - **Custom Scope Categories**: `projects`, `branches`, `schema`, `querying`, `performance`, `neon_auth`, `docs`. When scopes are provided, preset is automatically set to `custom`.
  - **HTTP Headers** (remote server): `X-Neon-Preset`, `X-Neon-Scopes`, `X-Neon-Project-Id`, `X-Neon-Protect-Production`, `X-Neon-Read-Only` (legacy `x-read-only` accepted as synonym).
  - **CLI Flags** (local server): `--preset`, `--scopes`, `--project-id`, `--protect-production`. Parsed in `landing/mcp-src/initConfig.ts`.

- **Analytics & Observability**: Every tool call, resource access, and error is tracked through Segment analytics and Sentry error reporting.

## Adding New Tools

1. Define the tool schema in `landing/mcp-src/tools/toolsSchema.ts`:

```typescript
export const myNewToolInputSchema = z.object({
  project_id: z.string().describe("The Neon project ID"),
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
import { ToolHandler } from "../types";
import { myNewToolInputSchema } from "../toolsSchema";

export const myNewToolHandler: ToolHandler<"my_new_tool"> = async (
  args,
  neonClient,
  extra,
) => {
  // Implementation
  return {
    content: [
      {
        type: "text",
        text: "Result message",
      },
    ],
  };
};
```

4. Register the handler in `landing/mcp-src/tools/tools.ts`:

```typescript
import { myNewToolHandler } from "./handlers/my-new-tool";

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
│   │   ├── authorize/  # OAuth authorization endpoint (renders preset UI)
│   │   ├── token/      # OAuth token exchange
│   │   ├── register/   # Dynamic client registration
│   │   ├── revoke/     # OAuth token revocation
│   │   └── health/     # Health check endpoint
│   ├── callback/       # OAuth callback handler
│   └── .well-known/    # OAuth discovery endpoints
│   # Note: Root `/` redirects to https://neon.tech/docs/ai/neon-mcp-server
│   # (configured in next.config.ts). There is no landing page.
├── lib/                # Next.js-compatible utilities
│   ├── config.ts       # Centralized configuration
│   └── oauth/          # OAuth utilities for Next.js
├── mcp-src/            # MCP server source code
│   ├── cli.ts          # CLI entry point (stdio transport)
│   ├── initConfig.ts   # CLI argument parsing (--preset, --project-id, etc.)
│   ├── server/         # MCP server factory
│   │   ├── index.ts    # Server creation and tool registration
│   │   ├── api.ts      # Neon API client factory
│   │   ├── account.ts  # Account resolution (user/org/project-scoped)
│   │   └── errors.ts   # Error handling utilities
│   ├── tools/          # Tool definitions and handlers
│   │   ├── definitions.ts     # Tool definitions (NEON_TOOLS) with annotations
│   │   ├── tools.ts           # Tool handlers mapping (NEON_HANDLERS)
│   │   ├── toolsSchema.ts     # Zod schemas for tool inputs
│   │   ├── handlers/          # Individual tool implementations
│   │   ├── grant-filter.ts    # Filters tools based on grant context (presets/scopes)
│   │   ├── grant-enforcement.ts # Enforces branch protection at runtime
│   │   ├── types.ts           # TypeScript types
│   │   └── utils.ts           # Tool utilities
│   ├── oauth/          # OAuth model and KV store
│   ├── analytics/      # Segment analytics
│   ├── sentry/         # Sentry error tracking
│   ├── transports/     # Transport implementations
│   │   └── stdio.ts    # Stdio transport for CLI
│   ├── types/          # Shared TypeScript types
│   ├── utils/          # Shared utilities
│   │   ├── read-only.ts       # Read-only mode detection, scope definitions
│   │   ├── grant-context.ts   # Grant context types, preset definitions, CLI grant parsing
│   │   ├── trace.ts           # TraceId generation for request correlation
│   │   ├── client-application.ts  # Client application utilities
│   │   ├── logger.ts          # Logging utilities
│   │   └── polyfills.ts       # Runtime polyfills
│   ├── resources.ts    # MCP resources
│   ├── prompts.ts      # LLM prompts
│   └── constants.ts    # Shared constants
├── components/         # React components (OAuth UI, shared UI primitives)
├── patches/            # npm package patches
├── public/             # Static assets
├── package.json        # Package configuration
├── tsconfig.json       # TypeScript config (bundler resolution)
├── next.config.ts      # Next.js config (redirects, rewrites)
├── vercel.json         # Vercel deployment config
└── vercel-migration.md # Migration documentation

mcp-client/             # CLI client for testing

dev-notes/              # Developer notes and solution documentation
└── *.md               # Problem solutions, fixes, and technical decisions
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

| Route                                     | Purpose                                             |
| ----------------------------------------- | --------------------------------------------------- |
| `/api/mcp`                                | Streamable HTTP transport (recommended)             |
| `/api/sse`                                | Server-Sent Events transport (deprecated)           |
| `/api/authorize`                          | OAuth authorization initiation                      |
| `/callback`                               | OAuth callback handler                              |
| `/api/token`                              | OAuth token exchange                                |
| `/api/revoke`                             | OAuth token revocation                              |
| `/api/register`                           | Dynamic client registration                         |
| `/.well-known/oauth-authorization-server` | OAuth server metadata (includes `scopes_supported`) |
| `/.well-known/oauth-protected-resource`   | OAuth protected resource metadata                   |

### OAuth Scopes and Presets

The server supports three OAuth scopes: `read`, `write`, and `*`. These are exposed via the `/.well-known/oauth-authorization-server` endpoint's `scopes_supported` field.

- **`read`**: Read-only access to Neon resources
- **`write`**: Full access including create/delete operations
- **`*`**: Wildcard, equivalent to full access

During OAuth authorization, the UI presents **permission presets** (radio buttons: Full Access, Local Development, Production Use) and a **"Protect production branches"** checkbox. The selected preset and grant context are encoded into the OAuth state and forwarded through the flow.

### Environment Variables (Vercel)

| Variable                      | Description                             |
| ----------------------------- | --------------------------------------- |
| `SERVER_HOST`                 | Server URL (falls back to `VERCEL_URL`) |
| `UPSTREAM_OAUTH_HOST`         | Neon OAuth provider URL                 |
| `CLIENT_ID` / `CLIENT_SECRET` | OAuth client credentials                |
| `COOKIE_SECRET`               | Secret for signed cookies               |
| `KV_URL`                      | Vercel KV (Upstash Redis) URL           |
| `OAUTH_DATABASE_URL`          | Postgres URL for token storage          |
| `SENTRY_DSN`                  | Sentry error tracking DSN               |
| `ANALYTICS_WRITE_KEY`         | Segment analytics write key             |

### Development Notes

- Import paths in `landing/mcp-src/` are extensionless (no `.js` suffix)
- See `landing/vercel-migration.md` for detailed migration documentation

## GitHub Workflows

### Deploy Preview Workflow

The `deploy-preview.yml` workflow enables deploying PRs to the preview environment (`preview-mcp.neon.tech`) for testing OAuth flows and remote MCP functionality.

**Usage:**

1. Add the `deploy-preview` label to a PR
2. The workflow pushes to the `preview` branch, which triggers Vercel deployment
3. Only one PR can own the preview environment at a time (label is auto-removed from other PRs)
4. Label is automatically removed when PR is merged or closed

**Note:** The preview environment has OAuth configured, making it the only way to test full OAuth flows in PRs.

### Claude Code Action Workflow

The `claude.yml` workflow enables interactive Claude assistance in issues and pull requests.

**Usage:**

- Mention `@claude` in any issue, PR comment, or PR review comment
- Claude will analyze and respond to your request
- Only works for OWNER/MEMBER/COLLABORATOR to prevent abuse

**Available Commands:**

- GitHub CLI commands (`gh issue:*`, `gh pr:*`, `gh search:*`)
- Can help with code review, issue triage, and PR descriptions

### Claude Code Review Workflow

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

## Testing the OAuth Consent Page Locally

The OAuth authorization page (`/api/authorize`) requires a registered OAuth client in the database. Since the dev server uses `OAUTH_DATABASE_URL` from `.env.local` for client storage, you need to register a client first.

### 1. Register an OAuth Client

With the dev server running (`cd landing && bun run dev`), use `curl` to dynamically register a client:

```bash
curl -s -X POST http://localhost:3000/api/register \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "My Test Client",
    "redirect_uris": ["http://localhost:3000/callback"],
    "grant_types": ["authorization_code"],
    "response_types": ["code"],
    "token_endpoint_auth_method": "none"
  }'
```

This returns a JSON response with `client_id` and `client_secret`. Save the `client_id` — you'll need it for the authorize URL.

**Important**: The `grant_types`, `response_types`, and `token_endpoint_auth_method` fields are required. Omitting them will return a 400 error.

### 2. Visit the OAuth Consent Page

Build the authorize URL with the registered `client_id`:

```
http://localhost:3000/api/authorize?response_type=code&client_id=<CLIENT_ID>&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback&state=test&code_challenge=test123456789012345678901234567890123456789&code_challenge_method=S256
```

Open this URL in a browser to see the OAuth consent page with preset tabs, scope categories, and branch protection options.

**Note**: After approving once, a signed cookie remembers the approval and will skip the dialog on subsequent visits. Use an incognito window or clear cookies to see the consent page again.

### 3. Take Screenshots with agent-browser

Use `agent-browser` to automate screenshots of different OAuth consent page states:

```bash
# Open the OAuth consent page
agent-browser open "http://localhost:3000/api/authorize?response_type=code&client_id=<CLIENT_ID>&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback&state=test&code_challenge=test123456789012345678901234567890123456789&code_challenge_method=S256"

# Take a full-page screenshot of the default view (Full Access preset)
agent-browser screenshot --full screenshots/full-access.png

# Get interactive elements to find button refs
agent-browser snapshot -i
# Output: button "Custom" [ref=e2], button "Local Development" [ref=e3], etc.

# Click different presets and screenshot each
agent-browser click @e2   # Custom preset
agent-browser screenshot --full screenshots/custom-preset.png

agent-browser click @e3   # Local Development preset
agent-browser screenshot --full screenshots/local-dev.png

# Expand permission details (collapsible section on non-custom presets)
agent-browser find text "Show permission details" click
agent-browser screenshot --full screenshots/local-dev-expanded.png

# Check the branch protection checkbox
agent-browser check @e6
agent-browser screenshot --full screenshots/with-branch-protection.png

# Clean up
agent-browser close
```

**agent-browser quick reference**:

- `agent-browser open <url>` — Navigate to page
- `agent-browser snapshot -i` — Get interactive elements with refs (`@e1`, `@e2`)
- `agent-browser click @e1` / `fill @e2 "text"` — Interact using refs
- `agent-browser screenshot [path.png]` — Screenshot (add `--full` for full page)
- `agent-browser find text "..." click` — Find by text and click
- `agent-browser check @e1` / `uncheck @e1` — Toggle checkboxes
- `agent-browser close` — Close browser
- Re-snapshot after page changes to get updated refs
