# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

> `CLAUDE.md` is a symlink to this file, so Claude Code and other tooling read the same content.

## Project Overview

This is the **Neon MCP Server** - a Model Context Protocol server that bridges natural language requests to the Neon API, enabling LLMs to manage Lakebase Postgres databases on Neon through conversational commands. The project implements remote (SSE/Streamable HTTP) MCP server transports with OAuth authentication support.

**Architecture Note**: The project is a Next.js application at the repository root, deployed on Vercel serverless infrastructure and accessible at `mcp.neon.tech`.

## Development Commands

All commands should be run from the repository root. The project uses [pnpm](https://pnpm.io) as the package manager, pinned via Corepack. Run `corepack enable` to activate it.

> **Troubleshooting:** If `pnpm install` fails with registry or network errors, check whether your npm registry is configured to use the Databricks proxy. Set the registry in `~/.npmrc` or `.npmrc`.

### Building and Running

```bash
pnpm install

# Start the Next.js dev server (for the remote MCP server)
pnpm dev
```

### Formatting, Linting, and Type Checking

```bash
# Check formatting (runs in CI)
pnpm fmt:check

# Auto-fix formatting
pnpm fmt

# Lint
pnpm lint

# Auto-fix lint + formatting together
pnpm lint:fix

# Type check
pnpm typecheck

# Check for unused code and dependencies
pnpm knip

# Auto-fix unused exports/dependencies
pnpm knip:fix
```

### Testing

```bash
# Run full test suite (unit + integration + e2e; used in CI)
pnpm test

# Run unit tests
pnpm test:unit

# Run integration tests
pnpm test:integration

# Run MCP protocol e2e tests (real tool calls over MCP protocol)
pnpm test:e2e:mcp

# Run live MCP → Neon E2E tests (requires .env.test)
pnpm test:e2e:live

# Run website e2e tests (Playwright; provisions/validates ephemeral DB first)
pnpm test:e2e:web

# Run all e2e tests
pnpm test:e2e
```

### Live MCP → Neon E2E tests

`pnpm test:e2e:live` runs a real MCP client and server over the SDK's in-memory
transport, while every tool call reaches the real Neon Management API and a real
temporary Neon database. This is more deterministic than starting an HTTP server
and shelling through `mcporter`, while still covering MCP schemas, tool
registration, handlers, `@neon/sdk`, connection-string resolution, and SQL.

Set up the dedicated disposable test organization:

```bash
cp .env.test.example .env.test
# Fill in NEON_API_KEY with an org-scoped key for the disposable test org.
# NEON_TEST_ORG_ID is inferred for org-scoped keys; set it for user keys.
pnpm test:e2e:live
```

The test only loads this repository's `.env.test`; it must not inspect parent or
workspace-global environment files. The suite asks `@neon/sdk` for the
organization attached to an org-scoped key.

The suite always creates a uniquely named `smoke-mcp-live-*` project first and
deletes it at the end. Cleanup runs from `afterAll` even when an assertion fails,
uses `@neon/sdk` to verify the project name before deletion, and refuses to
delete projects without the smoke prefix. Never point these variables at a
personal or production organization, and never commit `.env.test`.

For same-repository pull requests, `.github/workflows/pr.yml` maps the
repository secret `NEON_TEST_API_KEY` to `NEON_API_KEY` for this step. Fork and
Dependabot PRs skip the live suite because GitHub does not safely expose
repository secrets to untrusted PR code.

### Live API-key smoke testing with mcporter

To verify a local MCP server against the real Neon API, start it with `NEON_API_KEY` in its environment (for example, `pnpm exec next dev --port 3031`), then use `npx mcporter` from an untracked temporary directory to register `http://127.0.0.1:3031/mcp` with the header `Authorization: Bearer $NEON_API_KEY`. Create a clearly prefixed project in the approved smoke-test organization, exercise the changed tools (including project and branch lifecycle), then delete the project and the temporary mcporter config directory. Never print or commit the API key, connection strings, or the generated config.

### Testing Pyramid Rules

The repository follows this hierarchy:

1. **E2E first** (highest confidence):
   - `test:e2e:live`: MCP client + server + real Neon API/project/database lifecycle. Opt-in because it requires a dedicated test-org API key.
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

Keep the default unit/integration suites deterministic. The explicitly named
live Neon E2E step is the only merge check that depends on external
infrastructure.

**Unit and integration tests** use [Vitest](https://vitest.dev/) and live in `mcp/__tests__/`. Configuration is in `vitest.config.ts`.

**E2E tests** use [Playwright](https://playwright.dev/) and live in `e2e/`. Configuration is in `playwright.config.ts`.

- **Global setup** (`e2e/global-setup.ts`): Provisions an ephemeral Postgres database via [Instagres](https://instagres.com) and generates a random `COOKIE_SECRET`. Both are written to `.env.e2e` (gitignored) and passed to the Next.js dev server. It also starts the docs fixture server (see below).
- **Docs fixture** (`e2e/docs-fixture.ts`): The docs tools fetch their index server-side, so `request.route()` cannot intercept it and a test calling `list_docs_resources` would otherwise depend on neon.com being up — which merge-gating tests must not. Global setup serves `e2e/fixtures/docs-index.txt` on port `3101` (`E2E_DOCS_PORT` to change it, and it fails loudly if the port is taken), and `playwright.config.ts` points the dev server's `NEON_DOCS_INDEX_URL` at it. That URL must be set in `webServer.env`, not in global setup: Playwright starts the web server as a plugin task, which runs **before** global setup, so anything global setup adds to `process.env` reaches the dev server too late. Only the index is redirected — individual doc pages still come from `NEON_DOCS_BASE_URL`, and the fixture serves no page paths.
- **No secrets needed**: The e2e infrastructure is fully self-contained. Instagres databases expire after 72 hours; no explicit teardown is required.
- **Reuse across runs**: If `.env.e2e` already exists, global-setup reuses it instead of re-provisioning. Delete the file to force a fresh database.
- **CI**: The PR workflow runs format, lint, knip, `pnpm test`, live Neon E2E for trusted same-repo PRs, and build before merge.

## Architecture

### Core Components

1. **MCP Server (`mcp/server/index.ts`)**
   - Creates and configures the MCP server instance
   - Registers all tools and resources from centralized definitions
   - Implements error handling and observability (Sentry, analytics)
   - Each tool call is tracked and wrapped in error handling

   **Account Resolution (`mcp/server/account.ts`)**:
   - Resolves user/org account info from Neon API auth details
   - Handles org accounts, personal accounts, and project-scoped API keys
   - Falls back gracefully when project-scoped keys cannot access account-level endpoints

2. **Tools System (`mcp/tools/`)**
   - `definitions.ts`: Exports `NEON_TOOLS` array defining all available tools with their schemas
   - `tools.ts`: Exports `NEON_HANDLERS` object mapping tool names to handler functions
   - `toolsSchema.ts`: Zod schemas for tool input validation
   - `handlers/`: Individual tool handler implementations organized by feature

3. **Remote Transport (`app/api/[transport]/route.ts`)**
   - Next.js API route handling SSE and Streamable HTTP transports
   - Uses `mcp-handler` library for serverless MCP protocol handling
   - SSE sessions are bound to caller identity via `mcp/server/session-binding.ts` (Redis-backed; verifies the POST /message caller matches the GET /sse owner using a hashed binding key)

4. **OAuth System (`lib/oauth/` and `mcp/oauth/`)**
   - OAuth 2.0 server implementation for remote MCP authentication
   - Integrates with Neon's OAuth provider (UPSTREAM_OAUTH_HOST)
   - Token persistence using Keyv with Postgres backend
   - Cookie-based client approval tracking

5. **Resources (`mcp/resources.ts`)**
   - MCP resources that provide read-only context (like "getting started" guides)
   - Registered alongside tools but don't execute operations

6. **Grant Context & Tool Filtering (`mcp/utils/grant-context.ts`, `mcp/tools/grant-filter.ts`)**
   - Fine-grained access control beyond plain read/write: per-category scopes (`projects`, `branches`, `schema`, `querying`, `neon_auth`, `data_api`, `observability`, `docs`) and optional project-scoping to a single `projectId`
   - Grant resolved from OAuth resource URI query params (authorize-time), OAuth token grant field (runtime), or direct MCP URL query params for API-key auth
   - `grant-filter.ts` filters `NEON_TOOLS` by scope category, hides project-agnostic tools in project-scoped mode, and strips `project_id` from input schemas when scoped
   - Exposed publicly via `GET /api/list-tools` (stateless preview of tool visibility for a given grant)

### Key Architectural Patterns

- **Tool Registration Pattern**: All tools are defined in `NEON_TOOLS` array and handlers in `NEON_HANDLERS` object. The server iterates through tools and registers them with their corresponding handlers.

- **Error Handling**: Tools throw errors which are caught by the server wrapper, logged to Sentry, and returned as structured error messages to the LLM.

- **Stateless Design**: The server is designed for serverless deployment. Tools like migrations and query tuning create temporary branches but do NOT store state in memory. Instead, all context (branch IDs, migration SQL, etc.) is returned to the LLM, which passes it back to subsequent tool calls. This enables horizontal scaling on Vercel.

- **Read-Only Mode** (`mcp/utils/read-only.ts`): Tools define a `readOnlySafe` property. When the server runs in read-only mode, only tools marked as `readOnlySafe: true` are available. Read-only mode is determined by priority: `X-Neon-Read-Only` header > `x-read-only` header (legacy) > OAuth scope (only `read` scope = read-only) > default (false). The module also exports `SCOPE_DEFINITIONS` for human-readable scope labels and `hasWriteScope()` to check for write permissions.

- **MCP Tool Annotations**: All tools include MCP-standard annotations for client hints:
  - `title`: Human-readable tool name
  - `readOnlyHint`: Whether the tool only reads data
  - `destructiveHint`: Whether the tool can cause irreversible changes
  - `idempotentHint`: Whether repeated calls produce the same result
  - `openWorldHint`: Whether the tool interacts with external systems

- **Analytics & Observability**: Every tool call, resource access, and error is tracked through Segment analytics and Sentry error reporting.

## Adding New Tools

1. Define the tool schema in `mcp/tools/toolsSchema.ts`:

```typescript
export const myNewToolInputSchema = z.object({
  project_id: z.string().describe('The Neon project ID'),
  // ... other fields
});
```

2. Add the tool definition to `NEON_TOOLS` array in `mcp/tools/definitions.ts`:

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

3. Create a handler in `mcp/tools/handlers/my-new-tool.ts`:

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

4. Register the handler in `mcp/tools/tools.ts`:

```typescript
import { myNewToolHandler } from './handlers/my-new-tool';

export const NEON_HANDLERS = {
  // ... existing handlers
  my_new_tool: myNewToolHandler,
};
```

## Environment Configuration

See `.env.test.example` for live-test configuration. Runtime configuration is
normally provided through `.env.local`. Key variables:

- `NEON_API_KEY`: Required only for opt-in live Neon E2E tests and local API-key smoke tests
- `NEON_TEST_ORG_ID`: Dedicated disposable organization for live E2E tests; optional with an org-scoped key
- `OAUTH_DATABASE_URL`: Required for remote MCP server with OAuth
- `COOKIE_SECRET`: Required for remote MCP server OAuth flow
- `CLIENT_ID` / `CLIENT_SECRET`: OAuth client credentials

**E2E test environment**: The e2e tests do not require any manual environment configuration. `e2e/global-setup.ts` provisions an ephemeral database and generates secrets automatically, writing them to `.env.e2e` (gitignored).

## Project Structure

```
.                         # Repo root IS the Next.js app (deployed to mcp.neon.tech)
├── app/                 # Next.js App Router
│   ├── api/            # API routes for remote MCP server
│   │   ├── [transport]/route.ts  # Main MCP handler (SSE/Streamable HTTP)
│   │   ├── authorize/  # OAuth authorization endpoint (renders consent UI)
│   │   ├── token/      # OAuth token exchange
│   │   ├── register/   # Dynamic client registration
│   │   ├── revoke/     # OAuth token revocation
│   │   ├── list-tools/ # Stateless tool-visibility preview (no auth)
│   │   └── health/     # Health check endpoint
│   ├── callback/       # OAuth callback handler
│   └── .well-known/    # OAuth discovery endpoints
│   # Note: Root `/` redirects to https://neon.com/docs/ai/neon-mcp-server
│   # (configured in next.config.ts). There is no landing page.
├── e2e/                # Playwright E2E tests
│   ├── global-setup.ts             # Instagres DB provisioning + secret generation
│   ├── smoke.spec.ts               # Smoke tests (health, OAuth discovery, redirect)
│   ├── list-tools.spec.ts          # /api/list-tools visibility/grant tests
│   ├── mcp-response-integrity.spec.ts # MCP transport response shape checks
│   └── oauth-register-authorize.spec.ts # OAuth register + authorize flow
├── lib/                # Next.js-compatible utilities
│   ├── assert.ts       # Type-narrowing assertion helper
│   ├── config.ts       # Centralized configuration
│   ├── errors.ts       # OAuth-aware HTTP error mapping for route handlers
│   └── oauth/          # OAuth utilities for Next.js
├── mcp/            # MCP server source code
│   ├── __tests__/      # Vitest unit/integration/MCP e2e tests
│   │   ├── live/                   # Opt-in MCP → real Neon lifecycle tests
│   │   ├── *.test.ts              # Unit tests
│   │   ├── *.integration.test.ts  # Integration tests
│   │   └── *.e2e.test.ts          # MCP protocol e2e tests
│   ├── server/         # MCP server factory
│   │   ├── index.ts          # Server creation and tool registration
│   │   ├── api.ts            # Neon API client factory
│   │   ├── account.ts        # Account resolution (user/org/project-scoped)
│   │   ├── errors.ts         # Error handling utilities
│   │   └── session-binding.ts # Redis-backed SSE session-to-caller binding
│   ├── tools/          # Tool definitions and handlers
│   │   ├── index.ts        # Re-exports definitions and handlers
│   │   ├── definitions.ts  # Tool definitions (NEON_TOOLS) with annotations
│   │   ├── tools.ts        # Tool handlers mapping (NEON_HANDLERS)
│   │   ├── toolsSchema.ts  # Zod schemas for tool inputs
│   │   ├── grant-filter.ts # Filter NEON_TOOLS by grant context (scope categories, project scoping)
│   │   ├── handlers/       # Individual tool implementations
│   │   ├── types.ts        # TypeScript types
│   │   └── utils.ts        # Tool utilities
│   ├── oauth/          # OAuth model and KV store
│   ├── analytics/      # Segment analytics
│   ├── sentry/         # Sentry error tracking
│   ├── types/          # Shared TypeScript types
│   ├── utils/          # Shared utilities
│   │   ├── read-only.ts          # Read-only mode detection, SUPPORTED_SCOPES
│   │   ├── grant-context.ts      # Grant resolution + scope categories + project scoping
│   │   ├── singleflight.ts       # Promise deduplication by key (concurrent-call coalescing)
│   │   ├── trace.ts              # TraceId generation for request correlation
│   │   ├── client-application.ts # Client application utilities
│   │   └── logger.ts             # Logging utilities
│   ├── describeUtils.ts # Postgres \d-style describe helpers (derived from @neondatabase/psql-describe)
│   ├── resources.ts    # MCP resources
│   └── constants.ts    # Shared constants
├── public/             # Static assets (favicons, OG image, llms.txt)
├── .prettierrc         # Prettier config (singleQuote: true)
├── .prettierignore     # Prettier ignore patterns
├── vitest.config.ts    # Vitest configuration
├── playwright.config.ts # Playwright E2E configuration
├── package.json        # Package configuration
├── tsconfig.json       # TypeScript config (bundler resolution)
└── vercel.json         # Vercel deployment config

ai-notes/               # Docs, developer notes, and solution write-ups (see below)
├── SMOKE_TESTS.md      # Manual smoke-test checklist
├── vercel-migration.md # Vercel/pnpm migration write-up
└── *.md                # SLO definitions, incident notes, and technical decisions
```

## Repository Notes (`ai-notes/`)

Deeper context for agents and humans lives in [`ai-notes/`](ai-notes/): the manual
smoke-test checklist, the Vercel/pnpm migration write-up, and detailed SLO
definitions + incident investigations (e.g. the auth-callback and refresh SLOs).
Code comments reference these files by path (e.g. `ai-notes/refresh-slo.md`).

## Important Notes

- **TypeScript Configuration**: Uses `bundler` module resolution for Next.js compatibility. Imports use extensionless paths (no `.js` suffix).
- **Registry metadata version sync**: Keep root `server.json` `version` in sync with `package.json` `version`. CI enforces this via the PR workflow.

- **Migration Pattern**: Tools like `prepare_database_migration` and `prepare_query_tuning` create temporary branches and return all context (branch IDs, SQL, database name, etc.) in the response. The LLM must pass this context back to subsequent `complete_*` tools. No state is stored server-side, enabling serverless deployment.

- **Neon API Client**: Created in `mcp/neon-client.ts` on top of `@neon/sdk`. Every Neon request a tool makes goes through it — there is no raw-HTTP escape hatch — and all tool handlers receive a pre-configured `neonClient` instance.

## Remote MCP Server (Vercel)

The remote MCP server (`mcp.neon.tech`) is deployed on Vercel's serverless infrastructure.

### Key Technologies

- **Next.js App Router**: API routes handle MCP protocol and OAuth flow
- **mcp-handler library**: Abstracts MCP protocol complexity for serverless environments
- **Vercel Fluid Compute**: Supports up to 800s function duration for SSE connections
- **Upstash Redis**: Session storage via Vercel KV (`KV_URL` environment variable)
- **Postgres via Keyv**: Token persistence using `OAUTH_DATABASE_URL`

### API Endpoints

| Route                                     | Purpose                                                                           |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| `/api/mcp`                                | Streamable HTTP transport (recommended)                                           |
| `/api/sse`                                | Server-Sent Events transport (deprecated)                                         |
| `/api/authorize`                          | OAuth authorization initiation                                                    |
| `/callback`                               | OAuth callback handler                                                            |
| `/api/token`                              | OAuth token exchange                                                              |
| `/api/revoke`                             | OAuth token revocation                                                            |
| `/api/register`                           | Dynamic client registration                                                       |
| `/api/list-tools`                         | Stateless preview of available tools for a given grant (no auth)                  |
| `/.well-known/oauth-authorization-server` | OAuth server metadata (includes `scopes_supported` and `x-neon-scope-categories`) |
| `/.well-known/oauth-protected-resource`   | OAuth protected resource metadata                                                 |

### OAuth Scopes

The server supports three top-level scopes: `read`, `write`, and `*`. These are exposed via the `/.well-known/oauth-authorization-server` endpoint's `scopes_supported` field.

- **`read`**: Read-only access to Neon resources
- **`write`**: Full access including create/delete operations
- **`*`**: Wildcard, equivalent to full access

During authorization, users can uncheck "Full access" to request only `read` scope, which enables read-only mode.

In addition to the top-level scopes, the server exposes **scope categories** via the non-standard `x-neon-scope-categories` field on the same metadata document: `projects`, `branches`, `schema`, `querying`, `neon_auth`, `data_api`, `observability`, `docs`. These drive fine-grained tool filtering (see Grant Context above) and can also constrain a token to a single project. The `observability` category covers the OpenTelemetry logs tools (`query_logs`, `list_log_fields`, `list_log_field_values`). See `mcp/utils/grant-context.ts` for grant resolution.

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

- Import paths in `mcp/` are extensionless (no `.js` suffix)
- See `ai-notes/vercel-migration.md` for detailed migration documentation

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

- Formatting: `pnpm fmt:check` (checked by pr.yml)
- Linting: `pnpm lint` (checked by pr.yml)
- Tests: `pnpm test` (unit + integration + MCP e2e + website e2e, checked by `pr.yml`)
- Building: `pnpm build` (checked by pr.yml)

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
