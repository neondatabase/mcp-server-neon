# CLAUDE.md

This file provides guidance to AI agents when working with code in this repository.

## Project Overview

This is the **Neon MCP Server** - a Model Context Protocol server that bridges natural language requests to the Neon API, enabling LLMs to manage Neon Postgres databases through conversational commands. The project implements remote (SSE/Streamable HTTP) MCP server transports with OAuth authentication support.

**Architecture Note**: The project is a Next.js application in the `landing/` directory deployed on Vercel serverless infrastructure, accessible at `mcp.neon.tech`.

## Development Commands

All commands should be run from the `landing/` directory. The project uses [Bun](https://bun.sh) as the package manager.

### Building and Running

```bash
cd landing
bun install

# Start the Next.js dev server (for the remote MCP server)
bun run dev
```

### Formatting, Linting, and Type Checking

```bash
cd landing

# Check formatting (runs in CI)
bun run fmt:check

# Auto-fix formatting
bun run fmt

# Lint
bun run lint

# Auto-fix lint + formatting together
bun run lint:fix

# Type check
bun run typecheck

# Check for unused code and dependencies
bun run knip

# Auto-fix unused exports/dependencies
bun run knip:fix
```

### Testing

```bash
cd landing

# Run unit tests
bun run test:unit

# Run integration tests
bun run test:integration

# Run MCP protocol e2e tests (real tool calls over MCP protocol)
bun run test:e2e:mcp

# Run website e2e tests (Playwright)
bun run test:e2e:web

# Run all e2e tests
bun run test:e2e

# Run full test pyramid (used in CI before merge)
bun run test:all

# Watch mode for Vitest
bun run test:watch
```

### Testing Pyramid Rules

The repository follows this hierarchy:

1. **E2E first** (highest confidence):
   - `test:e2e:mcp`: MCP client + server protocol tests that perform real tool calls.
   - `test:e2e:web`: Playwright tests for website and HTTP endpoints.
2. **Integration second**:
   - Deterministic handler contract tests, typically with mocked external dependencies.
3. **Unit third**:
   - Fast tests for pure logic and validation edge cases.

Use file naming to classify tiers:

- `*.e2e.test.ts` for MCP protocol end-to-end tests
- `*.integration.test.ts` for integration tests
- `*.test.ts` for unit tests

Merge-gating tests must be deterministic. Do not make third-party uptime (for example, external docs websites) a required CI dependency.

**Unit and integration tests** use [Vitest](https://vitest.dev/) and live in `mcp-src/__tests__/`. Configuration is in `landing/vitest.config.ts`.

**E2E tests** use [Playwright](https://playwright.dev/) and live in `landing/e2e/`. Configuration is in `landing/playwright.config.ts`.

- **Global setup** (`e2e/global-setup.ts`): Provisions an ephemeral Postgres database via [Instagres](https://instagres.com) and generates a random `COOKIE_SECRET`. Both are written to `.env.e2e` (gitignored) and passed to the Next.js dev server.
- **No secrets needed**: The e2e infrastructure is fully self-contained. Instagres databases expire after 72 hours; no explicit teardown is required.
- **Reuse across runs**: If `.env.e2e` already exists, global-setup reuses it instead of re-provisioning. Delete the file to force a fresh database.
- **CI**: The PR workflow runs format, lint, unit+integration tests, MCP e2e tests, website e2e tests, and build before merge.

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

3. **Remote Transport (`landing/app/api/[transport]/route.ts`)**

   - Next.js API route handling SSE and Streamable HTTP transports
   - Uses `mcp-handler` library for serverless MCP protocol handling

4. **OAuth System (`landing/lib/oauth/` and `landing/mcp-src/oauth/`)**

   - OAuth 2.0 server implementation for remote MCP authentication
   - Integrates with Neon's OAuth provider (UPSTREAM_OAUTH_HOST)
   - Token persistence using Keyv with Postgres backend
   - Cookie-based client approval tracking

5. **Resources (`landing/mcp-src/resources.ts`)**
   - MCP resources that provide read-only context (like "getting started" guides)
   - Registered alongside tools but don't execute operations

### Key Architectural Patterns

- **Tool Registration Pattern**: All tools are defined in `NEON_TOOLS` array and handlers in `NEON_HANDLERS` object. The server iterates through tools and registers them with their corresponding handlers.

- **Error Handling**: Tools throw errors which are caught by the server wrapper, logged to Sentry, and returned as structured error messages to the LLM.

- **Stateless Design**: The server is designed for serverless deployment. Tools like migrations and query tuning create temporary branches but do NOT store state in memory. Instead, all context (branch IDs, migration SQL, etc.) is returned to the LLM, which passes it back to subsequent tool calls. This enables horizontal scaling on Vercel.

- **Read-Only Mode** (`landing/mcp-src/utils/read-only.ts`): Tools define a `readOnlySafe` property. When the server runs in read-only mode, only tools marked as `readOnlySafe: true` are available. Read-only mode is determined by priority: `X-READ-ONLY` header > OAuth scope (only `read` scope = read-only) > default (false). The module also exports `SCOPE_DEFINITIONS` for human-readable scope labels and `hasWriteScope()` to check for write permissions.

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

- `NEON_API_KEY`: Required for running tests (unit, integration, e2e)
- `OAUTH_DATABASE_URL`: Required for remote MCP server with OAuth
- `COOKIE_SECRET`: Required for remote MCP server OAuth flow
- `CLIENT_ID` / `CLIENT_SECRET`: OAuth client credentials

**E2E test environment**: The e2e tests do not require any manual environment configuration. `e2e/global-setup.ts` provisions an ephemeral database and generates secrets automatically, writing them to `.env.e2e` (gitignored).

## Project Structure

```
landing/                  # Next.js app (main project)
├── app/                 # Next.js App Router
│   ├── api/            # API routes for remote MCP server
│   │   ├── [transport]/route.ts  # Main MCP handler (SSE/Streamable HTTP)
│   │   ├── authorize/  # OAuth authorization endpoint (renders consent UI)
│   │   ├── token/      # OAuth token exchange
│   │   ├── register/   # Dynamic client registration
│   │   ├── revoke/     # OAuth token revocation
│   │   └── health/     # Health check endpoint
│   ├── callback/       # OAuth callback handler
│   └── .well-known/    # OAuth discovery endpoints
│   # Note: Root `/` redirects to https://neon.tech/docs/ai/neon-mcp-server
│   # (configured in next.config.ts). There is no landing page.
├── e2e/                # Playwright E2E tests
│   ├── global-setup.ts # Instagres DB provisioning + secret generation
│   └── smoke.spec.ts   # Smoke tests (health, OAuth discovery, redirect)
├── lib/                # Next.js-compatible utilities
│   ├── config.ts       # Centralized configuration
│   └── oauth/          # OAuth utilities for Next.js
├── mcp-src/            # MCP server source code
│   ├── __tests__/      # Vitest unit/integration/MCP e2e tests
│   │   ├── *.test.ts              # Unit tests
│   │   ├── *.integration.test.ts  # Integration tests
│   │   └── *.e2e.test.ts          # MCP protocol e2e tests
│   ├── server/         # MCP server factory
│   │   ├── index.ts    # Server creation and tool registration
│   │   ├── api.ts      # Neon API client factory
│   │   ├── account.ts  # Account resolution (user/org/project-scoped)
│   │   └── errors.ts   # Error handling utilities
│   ├── tools/          # Tool definitions and handlers
│   │   ├── index.ts       # Re-exports definitions and handlers
│   │   ├── definitions.ts  # Tool definitions (NEON_TOOLS) with annotations
│   │   ├── tools.ts       # Tool handlers mapping (NEON_HANDLERS)
│   │   ├── toolsSchema.ts # Zod schemas for tool inputs
│   │   ├── handlers/      # Individual tool implementations
│   │   ├── types.ts       # TypeScript types
│   │   └── utils.ts       # Tool utilities
│   ├── oauth/          # OAuth model and KV store
│   ├── analytics/      # Segment analytics
│   ├── sentry/         # Sentry error tracking
│   ├── types/          # Shared TypeScript types
│   ├── utils/          # Shared utilities
│   │   ├── read-only.ts    # Read-only mode detection, scope definitions
│   │   ├── trace.ts        # TraceId generation for request correlation
│   │   ├── client-application.ts  # Client application utilities
│   │   └── logger.ts       # Logging utilities
│   ├── resources.ts    # MCP resources
│   ├── prompts.ts      # LLM prompts
│   └── constants.ts    # Shared constants
├── public/             # Static assets (favicons, OG image, llms.txt)
├── .prettierrc         # Prettier config (singleQuote: true)
├── .prettierignore     # Prettier ignore patterns
├── vitest.config.ts    # Vitest configuration
├── playwright.config.ts # Playwright E2E configuration
├── package.json        # Package configuration
├── tsconfig.json       # TypeScript config (bundler resolution)
├── vercel.json         # Vercel deployment config
└── vercel-migration.md # Migration documentation

dev-notes/              # Developer notes and solution documentation
└── *.md               # Problem solutions, fixes, and technical decisions
```

## Important Notes

- **TypeScript Configuration**: Uses `bundler` module resolution for Next.js compatibility. Imports use extensionless paths (no `.js` suffix).

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
| `/.well-known/oauth-authorization-server` | OAuth server metadata (includes `scopes_supported`) |
| `/.well-known/oauth-protected-resource` | OAuth protected resource metadata |

### OAuth Scopes

The server supports three scopes: `read`, `write`, and `*`. These are exposed via the `/.well-known/oauth-authorization-server` endpoint's `scopes_supported` field.

- **`read`**: Read-only access to Neon resources
- **`write`**: Full access including create/delete operations
- **`*`**: Wildcard, equivalent to full access

During authorization, users can uncheck "Full access" to request only `read` scope, which enables read-only mode.

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

- Formatting: `bun run fmt:check` (checked by pr.yml)
- Linting: `bun run lint` (checked by pr.yml)
- Unit tests: `bun run test` (vitest, checked by pr.yml)
- E2E tests: `bun run test:e2e` (playwright, checked by pr.yml)
- Building: `bun run build` (checked by pr.yml)

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
