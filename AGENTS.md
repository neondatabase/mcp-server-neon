# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

## Project Overview

This is the **Neon MCP Server** - a Model Context Protocol server that bridges natural language requests to the Neon API, enabling LLMs to manage Lakebase Postgres databases on Neon through conversational commands. The project implements a stateless Streamable HTTP transport with OAuth authentication support.

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

- **Global setup** (`e2e/global-setup.ts`): Provisions an ephemeral Postgres database via [Instagres](https://instagres.com). The connection string is written to `.env.e2e` (gitignored) and passed to the Next.js dev server. It also starts the docs fixture server (see below).
- **Docs fixture** (`e2e/docs-fixture.ts`): `search_docs`, `get_doc`, and `send_feedback` fetch server-side, so `request.route()` cannot intercept them, and a test calling them would otherwise depend on neon-agent, neon.com, and the feedback service being up — which merge-gating tests must not. Global setup serves canned site search responses (chosen by query), one page (`/docs/reference/glossary.md`), and a feedback endpoint on port `3101` (`E2E_DOCS_PORT` to change it, and it fails loudly if the port is taken). `playwright.config.ts` points the dev server's `NEON_SITE_SEARCH_URL`, `NEON_DOCS_BASE_URL`, and `NEON_FEEDBACK_URL` at it. Those URLs must be set in `webServer.env`, not in global setup: Playwright starts the web server as a plugin task, which runs **before** global setup, so anything global setup adds to `process.env` reaches the dev server too late.
- **Sentry fixture** (`e2e/sentry-fixture.ts`): global setup also serves a Sentry ingestion stand-in on port `3102` (`E2E_SENTRY_PORT`), and `webServer.env` points `SENTRY_DSN` at it, so the suite's expected server errors never reach production Sentry. Tests read the spans and logs the server sent from `GET /items` (`e2e/session-tracing.spec.ts`).
- **No secrets needed**: The e2e infrastructure is fully self-contained. Instagres databases expire after 72 hours; no explicit teardown is required.
- **Reuse across runs**: If `.env.e2e` already exists, global-setup reuses it instead of re-provisioning. Delete the file to force a fresh database.
- **CI**: `.github/workflows/pr.yml` runs `lint-build` (version sync, format, lint, knip, build) first. Then `test` (`pnpm test:ci`: unit, integration, MCP e2e) and `e2e-web` (`pnpm test:e2e:web`) run in parallel, then `e2e-live` (`pnpm test:e2e:live`) for same-repo PRs that are not from Dependabot. The required `lint-and-build` check passes only when all of them succeed; fork and Dependabot PRs skip `e2e-live`. Shared setup (JFrog npm mirror, Node, pnpm, install) is the local action `.github/actions/setup`.

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
   - Every tool comes from [`@neon/tools`](https://www.npmjs.com/package/@neon/tools): its implementation, input schema, safety annotations, and description. This server keeps only what is MCP-specific.
   - `operations.ts`: the selected selectors and their grant metadata. `CUSTOM_TOOL_GRANTS` states scope, `readOnlySafe`, and `projectScoped` for the tools this server used to implement itself; `GENERATED_TOOL_SCOPES` gives the scope of every generated tool, whose `readOnlySafe` and `projectScoped` derive from method and path.
   - `mcp-tool-names.json`: the published MCP name of every selector. It is a copy of `packages/tools/scripts/mcp-tool-names.json` in neondatabase/neon-pkgs and must stay identical to it.
   - `neon-tools.ts`: the one `createNeonTools` call, with the pinned names, the MCP-only description notes, and the docs, feedback, and API endpoints from `lib/config.ts`
   - `definitions.ts`: `NEON_TOOLS`, each package tool with its MCP name, grant flags, and annotations
   - `tools.ts`: `NEON_HANDLERS`, which validate input, resolve `org_id`, pass the execution context (`apiKey`, `signal`, `readOnly`, `postgresRole`, `caller`), and render the package result as MCP content

3. **Remote Transport (`app/api/[transport]/route.ts`)**
   - Next.js API route handling stateless Streamable HTTP
   - Uses `mcp-handler` 2.x for MCP 2026-07-28 plus stateless 2025-era compatibility
   - Rejects untrusted `Origin` headers before docs-only or authenticated handling

4. **OAuth System (`lib/oauth/` and `mcp/oauth/`)**
   - OAuth 2.0 server implementation for remote MCP authentication
   - Integrates with Neon's OAuth provider (UPSTREAM_OAUTH_HOST)
   - Two client registration paths: Dynamic Client Registration (`/api/register`, client stored in KV) and Client ID Metadata Documents (an `https://` `client_id` resolved per request by `lib/oauth/client-id-metadata-document.ts`, nothing stored). `model.getClient` routes by the `https://` prefix; registered client IDs are generated server-side and never start with it. A document that declares `private_key_jwt` authenticates with a signed client assertion verified against its JWKS (`lib/oauth/client-assertion.ts`); `lib/oauth/client-credentials.ts` picks the method for token and revoke.
   - Token persistence using Keyv with Postgres backend
   - Cookie-based client approval tracking

5. **Grant Context & Tool Filtering (`mcp/utils/grant-context.ts`, `mcp/tools/grant-filter.ts`)**
   - Fine-grained access control beyond plain read/write: per-category scopes (`projects`, `branches`, `endpoints`, `snapshots`, `schema`, `querying`, `neon_auth`, `data_api`, `observability`, `docs`, `functions`, `storage`, `realtime`) and optional project-scoping to a single `projectId`
   - Grant resolved from OAuth resource URI query params (authorize-time), OAuth token grant field (runtime), or direct MCP URL query params for API-key auth. Those URL params stay camelCase (`projectId`, `category`, `readonly`).
   - `grant-filter.ts` filters `NEON_TOOLS` by scope category and hides project-agnostic tools in project-scoped mode. Project-aware published schemas keep `project_id` optional across grants; unscoped calls must supply it, while scoped calls can omit it or provide the matching grant ID. Injection precedes the original full handler schema validation.
   - Exposed publicly via `GET /api/list-tools` (stateless preview of tool visibility for a given grant)

### Key Architectural Patterns

- **Tool Registration Pattern**: All tools are defined in `NEON_TOOLS` array and handlers in `NEON_HANDLERS` object. The server iterates through tools and registers them with their corresponding handlers.

- **Error Handling**: Tools throw errors which are caught by the server wrapper, logged to Sentry, and returned as structured error messages to the LLM.

- **Stateless Design**: The server is designed for serverless deployment. Tools like migrations and query tuning create temporary branches but do NOT store state in memory. Instead, all context (branch IDs, migration SQL, etc.) is returned to the LLM, which passes it back to subsequent tool calls. This enables horizontal scaling on Vercel.

- **Read-Only Mode** (`mcp/utils/read-only.ts`): Tools define a `readOnlySafe` property. When the server runs in read-only mode, only tools marked as `readOnlySafe: true` are available. Read-only mode is determined by priority: `X-Neon-Read-Only` header > `x-read-only` header (legacy) > OAuth scope (only `read` scope = read-only) > default (false). The module also exports `SCOPE_DEFINITIONS` for human-readable scope labels and `hasWriteScope()` to check for write permissions.

  A `readOnlySafe` tool that runs caller-supplied SQL must run exactly one caller-supplied statement, as a prepared query, in its own `READ ONLY` transaction, as `run_sql` does. `run_sql_transaction` is not `readOnlySafe` because its statements share one transaction, so a `COMMIT` or `SET TRANSACTION READ WRITE` statement can end the transaction or switch it to read-write.

  `describe_branch` follows the same rule for its fixed structure query: one `SELECT` over the system catalogs in a `READ ONLY` transaction, in `@neon/tools`. Do not create helper objects to serve a read.

  SQL tools report `metadata.method: "SQL"` whether or not they can write, so `readOnlySafe` for them is stated per tool in `CUSTOM_TOOL_GRANTS`, never derived from the method.

- **MCP Tool Annotations**: All tools include MCP-standard annotations for client hints:
  - `title`: Human-readable tool name
  - `readOnlyHint`: Whether the tool only reads data
  - `destructiveHint`: Whether the tool can cause irreversible changes
  - `idempotentHint`: Whether repeated calls produce the same result
  - `openWorldHint`: Whether the tool interacts with external systems

- **Analytics & Observability**: Every tool call, resource access, and error is tracked through Segment analytics and Sentry. Each tool call gets one `tools/call <tool>` span (`mcp/sentry/tool-span.ts`) with OpenTelemetry MCP attributes; `tool_name` stays on it because existing Sentry dashboards query it. Only server failures (`isServerError` in `mcp/server/errors.ts`) mark it failed; agent mistakes set `error.type` only. Winston logs go to Sentry Logs too, so never log credentials, SQL, or request bodies.

- **Session ids**: the route gives a 2025-era client an `Mcp-Session-Id` on its `initialize` response (`mcp/utils/mcp-session.ts`). It is telemetry only: nothing is stored under it and an unknown id is never rejected. Every span, error, and log of a request carries it as `mcp.session.id`, so one query in Sentry returns a connection's whole chain of calls. 2026-07-28 requests have no sessions; a client's `_meta.threadId` (Codex) lands on tool spans as `gen_ai.conversation.id`. Both ids live on the request's root span (`mcp/sentry/session.ts`), not on the Sentry isolation scope.

- **Sentry init**: `instrumentation.ts` initializes Sentry before Next.js serves any request. Importing `mcp/sentry/instrument` from a route instead runs `init` during that route's first request, which then runs on the default isolation scope; every later request on the instance clones what it wrote there, such as `setUser`. `dataCollection` in `mcp/sentry/instrument.ts` keeps request headers, bodies, cookies, and query strings out of Sentry, because the OAuth routes carry client secrets, refresh tokens, PKCE verifiers, and authorization codes there; `e2e/sentry-privacy.spec.ts` checks it.

## Tool arguments

Every MCP tool argument is `snake_case`, as `@neon/tools` publishes it. Published schemas reject unknown keys: a camelCase alias (`projectId`) fails validation. URL grant query params stay camelCase (`?projectId=`, `?category=`, `?readonly=`) because those strings are already in issued OAuth grants and installed MCP URLs.

A published name, field, or required set never changes for an existing tool. Where the package differs, the MCP boundary keeps the old shape: `get_connection_string` takes `compute_id` (sent as `endpoint_id`) and no `pooled`, so it returns the SDK's default pooled URI (`GET_CONNECTION_STRING_INPUT_SCHEMA` in `definitions.ts`).

## Adding or Overriding a Tool

Tools are implemented in `@neon/tools` (neondatabase/neon-pkgs, `packages/tools`). A new tool, a fixed description, or a changed result shape belongs there; bump `@neon/tools` here to pick it up.

To publish a package tool on this server:

1. Add its selector to `operations.ts`. A generated Management API tool goes in `GENERATED_TOOL_SCOPES` with its scope category. A tool whose method or path does not say whether it is read-only safe or which project it touches (SQL, docs, anything without a Neon API path) goes in `CUSTOM_TOOL_GRANTS` with `scope`, `readOnlySafe`, and `projectScoped`:

```typescript
export const CUSTOM_TOOL_GRANTS = {
  'sql.run': { scope: 'querying', readOnlySafe: true, projectScoped: true },
  // ...
};
```

2. If the name the tool publishes under is not its package default (`publishedId(selector)`), add it to `mcp-tool-names.json` in neon-pkgs first and copy the file here unchanged.
3. Update the snapshots (`pnpm vitest run mcp/__tests__/hosted-tools-list.snapshot.test.ts -u`) and review the diff.

Overrides stay MCP-specific:

- Description text that only holds on this server (`org_id` auto-selection, read-only mode, connection scope) goes in `MCP_DESCRIPTION_NOTES` in `neon-tools.ts`, appended to the package text. Name other tools with `{{selector}}` so the reference resolves to their MCP name.
- A result that MCP clients already parse in a shape the package does not return gets a renderer in `RESULT_RENDERERS` in `tools.ts`. Every other result is JSON text; generated results also pass through `sanitize.ts`.
- `kind: 'custom'` tools take annotations from the package; generated tools derive them in `definitions.ts`.

## Environment Configuration

See `.env.test.example` for live-test configuration. Runtime configuration is
normally provided through `.env.local`. Key variables:

- `NEON_API_KEY`: Required only for opt-in live Neon E2E tests and local API-key smoke tests
- `NEON_TEST_ORG_ID`: Dedicated disposable organization for live E2E tests; optional with an org-scoped key
- `OAUTH_DATABASE_URL`: Required for remote MCP server with OAuth
- `CLIENT_ID` / `CLIENT_SECRET`: OAuth client credentials

**E2E test environment**: The e2e tests do not require any manual environment configuration. `e2e/global-setup.ts` provisions an ephemeral database, writing the connection string to `.env.e2e` (gitignored).

## Project Structure

```
.                         # Repo root IS the Next.js app (deployed to mcp.neon.tech)
├── app/                 # Next.js App Router
│   ├── api/            # API routes for remote MCP server
│   │   ├── [transport]/route.ts  # Stateless Streamable HTTP MCP handler
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
│   ├── tools/          # MCP layer over @neon/tools
│   │   ├── index.ts        # Re-exports handlers
│   │   ├── operations.ts   # Selected selectors, scope categories, grant flags
│   │   ├── mcp-tool-names.json # Published MCP name per selector (copy from neon-pkgs)
│   │   ├── neon-tools.ts   # createNeonTools call, MCP description notes
│   │   ├── definitions.ts  # Tool definitions (NEON_TOOLS) with annotations
│   │   ├── tools.ts        # Tool handlers (NEON_HANDLERS) and result rendering
│   │   ├── sanitize.ts     # Credential stripping for generated results
│   │   ├── grant-filter.ts # Filter NEON_TOOLS by grant context (scope categories, project scoping)
│   │   ├── types.ts        # TypeScript types
│   │   └── utils.ts        # org_id selection
│   ├── oauth/          # OAuth model and KV store
│   ├── analytics/      # Segment analytics
│   ├── sentry/         # Sentry setup, tool spans, session tagging
│   ├── types/          # Shared TypeScript types
│   ├── utils/          # Shared utilities
│   │   ├── read-only.ts          # Read-only mode detection, SUPPORTED_SCOPES
│   │   ├── grant-context.ts      # Grant resolution + scope categories + project scoping
│   │   ├── singleflight.ts       # Promise deduplication by key (concurrent-call coalescing)
│   │   ├── trace.ts              # TraceId generation for request correlation
│   │   ├── client-application.ts # Client application utilities
│   │   └── logger.ts             # Logging utilities
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
- **Server metadata**: `server.json` `title`, `description`, `websiteUrl`, and `icons` are also the `serverInfo` sent on `initialize` and `server/discover`, and the Server Card fields (`lib/server-metadata.ts`). Edit them there only.

- **Migration Pattern**: Tools like `prepare_database_migration` and `prepare_query_tuning` create temporary branches and return all context (branch IDs, SQL, database name, etc.) in the response. The LLM must pass this context back to subsequent `complete_*` tools. No state is stored server-side, enabling serverless deployment.

- **Neon API Client**: Tools call the Neon API through `@neon/tools` with `fetchAsMcpServer` from `mcp/neon-client.ts`, which sets the server's `User-Agent`. `createNeonClient` in the same file covers the calls outside tools: account resolution, `org_id` selection, and the live suites' setup and cleanup.

## Remote MCP Server (Vercel)

The remote MCP server (`mcp.neon.tech`) is deployed on Vercel's serverless infrastructure.

### Key Technologies

- **Next.js App Router**: API routes handle MCP protocol and OAuth flow
- **mcp-handler library**: Abstracts MCP protocol complexity for serverless environments
- **Vercel Fluid Compute**: 800-second API route ceiling for long-running tool calls
- **Postgres** (`OAUTH_DATABASE_URL`): token persistence and API-key caching via Keyv, OAuth transactions, and the cross-instance refresh-token lock (`mcp/oauth/refresh-lock.ts`)
- **Upstash Redis** (`KV_URL`, transitional): the refresh-token lock also takes the Redis lock while `KV_URL` is set, so deployments from before the Postgres lock keep coordinating. Remove once no such deployment serves traffic.

### API Endpoints

| Route                                     | Purpose                                                                           |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| `/api/mcp`                                | Streamable HTTP transport (recommended)                                           |
| `/api/sse`, `/api/message`                | Retired HTTP+SSE endpoints (`410 Gone`)                                           |
| `/api/authorize`                          | OAuth authorization initiation                                                    |
| `/callback`                               | OAuth callback handler                                                            |
| `/api/token`                              | OAuth token exchange                                                              |
| `/api/revoke`                             | OAuth token revocation                                                            |
| `/api/register`                           | Dynamic client registration                                                       |
| `/api/list-tools`                         | Stateless preview of available tools for a given grant (no auth)                  |
| `/.well-known/oauth-authorization-server` | OAuth server metadata (includes `scopes_supported` and `x-neon-scope-categories`) |
| `/.well-known/oauth-protected-resource`   | OAuth protected resource metadata                                                 |
| `/mcp/server-card`                        | MCP Server Card (public, built from `server.json`)                                |
| `/.well-known/ai-catalog.json`            | AI Catalog pointing at the Server Card                                            |
| `/.well-known/mcp.json`                   | Same Server Card at the SEP-1649 path that directory scanners probe               |

### OAuth Scopes

The advertised OAuth scopes are `read` and `write`, listed in `scopes_supported` on `/.well-known/oauth-authorization-server`.

- **`read`**: Read-only access to Neon resources
- **`write`**: Full access including create/delete operations

`*` is a request-time alias for write, and the scope stored on API-key tokens. It is not listed in `scopes_supported`. If a client requests `*` and write is granted, the issued token includes `*`.

During authorization, a parameterized MCP URL (`projectId`, `category`, and/or `readonly`) is a fixed confirmation. A bare or omitted resource URL lets the user choose project, categories, and (when the OAuth request allows write) **Allow writes**. Issued OAuth scope is `read` or `read write`; project and categories are stored on the token grant, not as extra OAuth scope strings.

In addition to the top-level scopes, the server exposes **scope categories** via the non-standard `x-neon-scope-categories` field on the same metadata document: `projects`, `branches`, `endpoints`, `snapshots`, `schema`, `querying`, `neon_auth`, `data_api`, `observability`, `docs`, `functions`, `storage`, `realtime`. These drive fine-grained tool filtering (see Grant Context above) and can also constrain a token to a single project. The `observability` category covers logs (`query_logs`, `query_loki_logs`, `list_log_fields`, `list_log_field_values`) plus the AI Gateway GET. The `functions` category includes scheduled triggers. The `branches` category includes roles, databases, and branch credentials (`list_credentials`, `create_credential`, `revoke_credential`, `rotate_credential`); `credentials.reveal` is not a tool. The `realtime` category holds the branch Realtime tools; `get_realtime_secret` is not `readOnlySafe`. See `mcp/utils/grant-context.ts` for grant resolution.

### Environment Variables (Vercel)

| Variable                      | Description                             |
| ----------------------------- | --------------------------------------- |
| `SERVER_HOST`                 | Server URL (falls back to `VERCEL_URL`) |
| `UPSTREAM_OAUTH_HOST`         | Neon OAuth provider URL                 |
| `CLIENT_ID` / `CLIENT_SECRET` | OAuth client credentials                |
| `KV_URL`                      | Upstash Redis URL (transitional lock)   |
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
