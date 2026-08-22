<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://neon.com/brand/neon-logo-dark-color.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://neon.com/brand/neon-logo-light-color.svg">
  <img width="250px" alt="Neon Logo fallback" src="https://neon.com/brand/neon-logo-dark-color.svg">
</picture>

# Neon MCP Server

[![Install MCP Server in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en-US/install-mcp?name=Neon&config=eyJ1cmwiOiJodHRwczovL21jcC5uZW9uLnRlY2gvbWNwP2NhdGVnb3J5PXByb2plY3RzJmNhdGVnb3J5PWJyYW5jaGVzJmNhdGVnb3J5PWVuZHBvaW50cyZjYXRlZ29yeT1xdWVyeWluZyZjYXRlZ29yeT1zY2hlbWEifQ%3D%3D)
[![Add to Kiro](https://kiro.dev/images/add-to-kiro.svg)](https://kiro.dev/launch/mcp/add?name=Neon&config=%7B%22url%22%3A%22https%3A%2F%2Fmcp.neon.tech%2Fmcp%3Fcategory%3Dprojects%26category%3Dbranches%26category%3Dendpoints%26category%3Dquerying%26category%3Dschema%22%7D)

**Neon MCP Server** is an open-source tool that lets you interact with your Lakebase Postgres databases on Neon in **natural language**.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

The Model Context Protocol (MCP) is a [standardized protocol](https://modelcontextprotocol.io) designed to manage context between large language models (LLMs) and external systems. This repository provides a remote MCP Server for [Neon](https://neon.com).

Neon's MCP server acts as a bridge between natural language requests and the [Neon API](https://neon.com/docs/reference/api). Built upon MCP, it translates your requests into the necessary API calls, enabling you to manage tasks such as creating projects and branches, running queries, and performing database migrations seamlessly.

Some of the key features of the Neon MCP server include:

- **Natural language interaction:** Manage Neon databases using intuitive, conversational commands.
- **Simplified database management:** Perform complex actions without writing SQL or directly using the Neon API.
- **Accessibility for non-developers:** Empower users with varying technical backgrounds to interact with Neon databases.
- **Database migration support:** Leverage Neon's branching capabilities for database schema changes initiated via natural language.

For example, in Claude Code, or any MCP Client, you can use natural language to accomplish things with Neon, such as:

- `Let's create a new Postgres database, and call it "my-database". Let's then create a table called users with the following columns: id, name, email, and password.`
- `I want to run a migration on my project called "my-project" that alters the users table to add a new column called "created_at".`
- `Can you give me a summary of all of my Neon projects and what data is in each one?`

> [!WARNING]  
> **Neon MCP Server Security Considerations**  
> The Neon MCP Server grants powerful database management capabilities through natural language requests. **Always review and authorize actions requested by the LLM before execution.** Ensure that only authorized users and applications have access to the Neon MCP Server.
>
> The Neon MCP Server is intended for local development and IDE integrations only. **We do not recommend using the Neon MCP Server in production environments.** It can execute powerful operations that may lead to accidental or unauthorized changes.
>
> For more information, see [MCP security guidance →](https://neon.com/docs/ai/neon-mcp-server#mcp-security-guidance).

## Setting up Neon MCP Server

There are a few options for setting up the Neon MCP Server:

1. **Quick Setup with API Key (Cursor, VS Code, and Claude Code):** Run [`neon@latest init`](https://neon.com/docs/cli/init) to automatically configure Neon's MCP Server, [agent skills](https://github.com/neondatabase/agent-skills), and VS Code extension with one command.
2. **Remote MCP Server (OAuth Based Authentication):** Connect to Neon's managed MCP server using OAuth for authentication. This method is more convenient as it eliminates the need to manage API keys. Additionally, you will automatically receive the latest features and improvements as soon as they are released.
3. **Remote MCP Server (API Key Based Authentication):** Connect to Neon's managed MCP server using API key for authentication. This method is useful if you want to connect a remote agent to Neon where OAuth is not available. Additionally, you will automatically receive the latest features and improvements as soon as they are released.

### Prerequisites

- An MCP Client application.
- A [Neon account](https://console.neon.tech/signup).
- **Node.js (>= v18.0.0):** Download from [nodejs.org](https://nodejs.org).
- If [IP Allow](https://neon.com/docs/introduction/ip-allow) is enabled, add `34.192.103.46` and `23.22.233.166` to your allowlist (`mcp.neon.tech` static IPs).

For development, you'll need Node.js 22+ (pnpm is provided via Corepack — run `corepack enable` to activate it).

### Option 1. Quick Setup with API Key

**Don't want to manually create an API key?**

Run [`neon@latest init`](https://neon.com/docs/cli/init) to automatically configure Neon's MCP Server with one command:

```bash
npx neon@latest init
```

This works with Cursor, VS Code (GitHub Copilot), and Claude Code. It will authenticate via OAuth, create a Neon API key for you, and configure your editor automatically.

### Option 2. Remote Hosted MCP Server (OAuth Based Authentication)

Connect to Neon's managed MCP server using OAuth for authentication. This is the easiest setup, requires no local installation of this server, and doesn't need a Neon API key configured in the client.

Run the following command to add the Neon MCP Server for all detected agents and editors in your workspace:

```bash
npx add-mcp "https://mcp.neon.tech/mcp?category=projects&category=branches&category=endpoints&category=querying&category=schema"
```

That URL publishes projects, branches, compute endpoints, querying, and schema. Preview the exact set with `/api/list-tools`. VS Code Copilot caps a request at 128 tools. The unfiltered URL publishes every category:

```bash
npx add-mcp https://mcp.neon.tech/mcp
```

Add the `-g` flag to add the Neon MCP Server to the global MCP server list instead of project-scoped.

Alternatively, you can add the following "Neon" entry to your client's MCP server configuration file (e.g., `mcp.json`, `mcp_config.json`):

```json
{
  "mcpServers": {
    "Neon": {
      "type": "http",
      "url": "https://mcp.neon.tech/mcp?category=projects&category=branches&category=endpoints&category=querying&category=schema"
    }
  }
}
```

**Kiro:** Add the following to your Kiro MCP config file (`~/.kiro/settings/mcp.json` for global, or `.kiro/settings/mcp.json` for project-scoped):

```json
{
  "mcpServers": {
    "Neon": {
      "url": "https://mcp.neon.tech/mcp?category=projects&category=branches&category=endpoints&category=querying&category=schema"
    }
  }
}
```

Or use the one-click install button at the top of this README. For more information, see the [Kiro MCP documentation](https://kiro.dev/docs/mcp/).

- Restart or refresh your MCP client.
- An OAuth window will open in your browser. Follow the prompts to authorize your MCP client to access your Neon account.

> With OAuth-based authentication, the MCP server will, by default, operate on projects under your personal Neon account. To access or manage projects that belong to an organization, you must explicitly provide either the `org_id` or the `project_id` in your prompt to MCP client.

### Option 3. Remote Hosted MCP Server (API Key Based Authentication)

Remote MCP Server also supports authentication using an API key in the `Authorization` header if your client supports it.

[Create a Neon API key](https://console.neon.tech/app/settings?modal=create_api_key) in the Neon Console. Next, run the following command to add the Neon MCP Server for all detected agents and editors in your workspace:

```bash
npx add-mcp "https://mcp.neon.tech/mcp?category=projects&category=branches&category=endpoints&category=querying&category=schema" --header "Authorization: Bearer <$NEON_API_KEY>"
```

Alternatively, you can add the following "Neon" entry to your client's MCP server configuration file (e.g., `mcp.json`, `mcp_config.json`):

```json
{
  "mcpServers": {
    "Neon": {
      "type": "http",
      "url": "https://mcp.neon.tech/mcp?category=projects&category=branches&category=endpoints&category=querying&category=schema",
      "headers": {
        "Authorization": "Bearer <$NEON_API_KEY>"
      }
    }
  }
}
```

> Provide an organization's API key to limit access to projects under the organization only.

### Scopes and Read-Only Mode

Neon MCP supports OAuth scopes `read`, `write`, and `*` (`*` means both). Your MCP client can request these scopes directly, or you can make the selection in the OAuth permissions UI.

**Read-only mode** restricts which tools are available, disabling write operations like creating projects, branches, or running migrations. Read-only tools include listing projects, describing schemas, querying data, and viewing performance metrics.

You can set read-only mode in two ways:

1. **OAuth scope selection (recommended):** In OAuth, select read-only by unchecking **Full access** in the authorization UI.
2. **`readonly` query param:** Add `?readonly=true` to your MCP server URL:

```json
{
  "mcpServers": {
    "Neon": {
      "url": "https://mcp.neon.tech/mcp?readonly=true"
    }
  }
}
```

How the query param behaves:

- **API key flow:** `readonly=true` is the way to enable read-only mode (there is no OAuth scope exchange in this flow).
- **OAuth flow:** `readonly=true` overrides the OAuth scope. Without it, read-only is determined by the scope selected in the OAuth consent UI.

Legacy HTTP header `x-read-only` is also supported as a fallback (lower priority than the query param).

> **Note:** Read-only mode restricts which _tools_ are available. Further, the `run_sql` tool remains available only for read-only queries.

### URL Query Params for Access Control

Grant context (scope categories, project scoping, read-only mode) is configured via URL query params on the MCP server URL. Config travels with every request and takes effect immediately — no re-auth needed.

| Param       | Description                                            | Example                              |
| ----------- | ------------------------------------------------------ | ------------------------------------ |
| `readonly`  | Enable read-only mode (`true`/`false`)                 | `?readonly=true`                     |
| `category`  | Restrict to specific tool categories (repeated or CSV) | `?category=querying&category=schema` |
| `projectId` | Scope all operations to a single project               | `?projectId=proj-123`                |

**Read-only + project-scoped example:**

```json
{
  "mcpServers": {
    "Neon": {
      "url": "https://mcp.neon.tech/mcp?readonly=true&projectId=my-project-id"
    }
  }
}
```

**Category-filtered example (only querying and schema tools):**

```json
{
  "mcpServers": {
    "Neon": {
      "url": "https://mcp.neon.tech/mcp?category=querying&category=schema"
    }
  }
}
```

You can preview which tools are visible for any configuration using the `/api/list-tools` endpoint (no auth required):

```bash
curl "https://mcp.neon.tech/api/list-tools?readonly=true&category=querying"
```

<details>
<summary><strong>Tools available in read-only mode</strong></summary>

Host tools: `list_organizations`, `describe_branch`, `run_sql`, `run_sql_transaction`, `get_database_tables`, `describe_table_schema`, `list_slow_queries`, `explain_sql_statement`, `inspect_database`, `get_neon_auth_config`, `search`, `fetch`, `list_docs_resources`, `get_doc_resource`.

Generated Management API tools that are GET and do not return secrets, plus `logs_query` (POST, read-only). Preview the exact set with `/api/list-tools?readonly=true`.

**Tools requiring write access:**

- Generated Management API writes (`create_project`, `create_branch`, `projects_delete`, …)
- `get_connection_string` (the connection string carries a privileged role password, so it is withheld in read-only mode; copy it from the [Neon Console](https://console.neon.tech) instead)
- `prepare_database_migration`, `complete_database_migration`
- `prepare_query_tuning`, `complete_query_tuning`

</details>

### Server-Sent Events (SSE) Transport (Deprecated)

MCP supports two remote server transports: the deprecated Server-Sent Events (SSE) and the newer, recommended Streamable HTTP. If your LLM client doesn't support Streamable HTTP yet, you can switch the endpoint from `https://mcp.neon.tech/mcp` to `https://mcp.neon.tech/sse` to use SSE instead.

Run the following command to add the Neon MCP Server for all detected agents and editors in your workspace using the SSE transport:

```bash
npx add-mcp https://mcp.neon.tech/sse --type sse
```

## Remote Server Architecture

The remote server runs as a Next.js App Router application on Vercel at `mcp.neon.tech`.

> [!NOTE]
> The root `/` path redirects to [Neon MCP Server docs](https://neon.com/docs/ai/neon-mcp-server). There is no landing page.

Core implementation areas:

- `app/api/[transport]/route.ts`: MCP transport endpoint for Streamable HTTP (`/mcp`) and SSE (`/sse`)
- `app/api/authorize/`, `app/callback/`, `app/api/token/`, `app/api/revoke/`: OAuth flow endpoints
- `app/.well-known/`: OAuth discovery metadata endpoints
- `mcp/`: MCP server, tools, handlers, analytics, and Sentry integration
- `lib/`: Next.js-compatible helpers (OAuth, configuration, error handling)
- `mcp/utils/read-only.ts`: read-only mode and scope handling

## Guides

- [Neon MCP Server Guide](https://neon.com/docs/ai/neon-mcp-server)
- [Connect MCP Clients to Neon](https://neon.com/docs/ai/connect-mcp-clients-to-neon)
- [Cursor with Neon MCP Server](https://neon.com/guides/cursor-mcp-neon)
- [Claude Code with Neon MCP Server](https://neon.com/guides/claude-code-mcp-neon)
- [Claude Desktop with Neon MCP Server](https://neon.com/guides/neon-mcp-server)
- [Cline with Neon MCP Server](https://neon.com/guides/cline-mcp-neon)
- [Windsurf with Neon MCP Server](https://neon.com/guides/windsurf-mcp-neon)
- [Zed with Neon MCP Server](https://neon.com/guides/zed-mcp-neon)

## Features

### Supported Tools

The Neon MCP Server provides the following actions, which are exposed as "tools" to MCP Clients. You can use these tools to interact with your Neon projects and databases using natural language commands.

#### Tool Scope Metadata

Each tool definition includes a `scope` category used for grant-based tool filtering and consent UX. Current categories are:

- `projects`
- `branches`
- `endpoints`
- `snapshots`
- `schema`
- `querying`
- `neon_auth`
- `data_api`
- `observability`
- `docs`
- `functions`
- `storage`
- `null` (tools without a scope category)

Notes:

- Management API tools come from `@neon/tools`. Selectors are SDK paths (`projects.list`); published names are those paths in snake_case (`projects_list`). `create_project`, `create_branch`, and `delete_branch` keep those names.
- `?category=branches` includes branch, role, and database tools (`postgres_roles_*`, `postgres_databases_*`). A token already issued for `branches` gains those writes. Compute listing is `?category=endpoints`. Snapshot restore is `?category=snapshots`.
- Project member and permission writes are not published. `projects_members_list` and `projects_permissions_list` are reads.
- Schema tools are host tools (`get_database_tables`, `describe_table_schema`). There is no generated schema-compare tool.
- Read-only enforcement still relies on `readOnlySafe` and server-side read-only logic; `scope` is category metadata, not a standalone read/write switch.
- In project-scoped mode (`?projectId=...`), tools without a project path (`projects_list`, `create_project`, `list_organizations`, `regions_list`, `search`, `fetch`, …) are hidden. `projects_delete` is also hidden.

**Project Management:**

- **`projects_list`**: Lists Neon projects. `limit` caps how many items come back.
- **`projects_get`**: Fetches a Neon project by id (`{ "project_id": "…" }`).
- **`create_project`**: Creates a Neon project, waits for the default compute, and returns a connection string. Arguments are `{ "name": "…", "org_id": "…", "region_id": "…" }`.
- **`projects_delete`**: Deletes an existing Neon project. Arguments are `{ "project_id": "…" }`.
- **`list_organizations`**: Lists all organizations that the current user has access to. Optionally filter by organization name or ID using the search parameter.

**Branch Management:**

- **`branches_list`**: Lists branches in a project. Use it to resolve a branch name to a `br-…` id.
- **`create_branch`**: Creates a branch with a read-write compute, waits until it is ready, and returns a connection string. Arguments are `{ "project_id": "…", "name": "feature-x" }`.
- **`delete_branch`**: Deletes a branch (`{ "project_id": "…", "branch_id": "br-…" }`).
- **`describe_branch`**: Retrieves a tree of databases, schemas, tables, views, and functions on a branch.
- Generated branch tools take `branch_id` as a branch id (`br-...`), not a name.
- **`snapshots_restore`**: Restores a snapshot. Pass `target_branch_id` to restore onto an existing branch; omit it to create a new one.

**Compute endpoints** (`?category=endpoints`):

- **`postgres_endpoints_list`**, **`postgres_endpoints_list_by_branch`**, **`postgres_endpoints_get`**, **`postgres_endpoints_create`**, **`postgres_endpoints_update`**, **`postgres_endpoints_delete`**, **`postgres_endpoints_start`**, **`postgres_endpoints_suspend`**, **`postgres_endpoints_restart`**

**Snapshots** (`?category=snapshots`):

- **`snapshots_list`**, **`snapshots_get_schedule`**, **`snapshots_set_schedule`**, **`snapshots_create`**, **`snapshots_update`**, **`snapshots_delete`**, **`snapshots_restore`**

**Schema** (`?category=schema`):

- Host tools only: `get_database_tables`, `describe_table_schema`, `describe_branch`.

**SQL Query Execution:**

- **`get_connection_string`**: Returns your database connection string.
- **`run_sql`**: Executes a single SQL query against a specified Neon database. Supports both read and write operations.
- **`run_sql_transaction`**: Executes a series of SQL queries within a single transaction against a Neon database.
- **`get_database_tables`**: Lists all tables within a specified Neon database.
- **`describe_table_schema`**: Retrieves the schema definition of a specific table, detailing columns, data types, and constraints.

**Database Migrations (Schema Changes):**

- **`prepare_database_migration`**: Initiates a database migration process. Critically, it creates a temporary branch to apply and test the migration safely before affecting the main branch.
- **`complete_database_migration`**: Finalizes and applies a prepared database migration to the main branch. This action merges changes from the temporary migration branch and cleans up temporary resources.

**SQL Querying and Optimization:**

- **`inspect_database`**: Runs one of 14 predefined read-only Postgres diagnostics against a branch — relation and index sizes, index and sequential-scan usage, active queries and locks, the heaviest and most frequent queries, cache hit rate and working-set size, autovacuum and bloat estimates, and replication state. Same checks as the `neon inspect db` CLI command. Omit `databaseName` to cover every database on the branch; pass a name to inspect one. Four of them need the `pg_stat_statements` or `neon` extension.
- **`list_slow_queries`**: Identifies performance bottlenecks by finding the slowest queries in a database. Requires the pg_stat_statements extension.
- **`explain_sql_statement`**: Provides detailed execution plans for SQL queries to help identify performance bottlenecks.
- **`prepare_query_tuning`**: Analyzes query performance and suggests optimizations, like index creation. Creates a temporary branch for safely testing these optimizations.
- **`complete_query_tuning`**: Finalizes query tuning by either applying optimizations to the main branch or discarding them. Cleans up the temporary tuning branch.

**Neon Auth** (`?category=neon_auth`):

- **`auth_create`**, **`auth_get`**, **`auth_disable`**, **`auth_update_config`**
- **`get_neon_auth_config`**: host tool; secrets redacted. Use generated Auth write tools to change settings.
- **`auth_oauth_providers_list`**, **`auth_oauth_providers_add`**, **`auth_oauth_providers_update`**, **`auth_oauth_providers_delete`**
- **`auth_trusted_domains_list`**, **`auth_trusted_domains_add`**, **`auth_trusted_domains_delete`**
- **`auth_users_create`**, **`auth_users_delete`**, **`auth_users_update_role`**

**Neon Data API** (`?category=data_api`):

- **`postgres_data_api_create`**, **`postgres_data_api_get`**, **`postgres_data_api_update`**, **`postgres_data_api_delete`**: Manage the Data API for a branch database.

**Search and Discovery:**

- **`search`**: Searches across organizations, projects, and branches matching a query. Returns IDs, titles, and direct links to the Neon Console.
- **`fetch`**: Fetches detailed information about a specific organization, project, or branch using an ID (typically from the search tool).

**Observability** (`?category=observability`): these tools require the Neon Platform Beta and are currently only available for projects in the `aws-us-east-2` region. A branch without logs access returns HTTP 404 with reason `telemetry_not_enabled`.

- **`logs_query`**: Queries OpenTelemetry logs for a branch. POST in the Management API; treated as read-only by this server.
- **`logs_fields`**: Lists the log fields you can enumerate values for on a branch.
- **`logs_field_values`**: Lists the distinct values of a log field within a branch and time window.

**Documentation and Resources** (`?category=docs`):

- **`list_docs_resources`**: Lists all available Neon documentation pages by fetching the index from `https://neon.com/docs/llms.txt`. Returns page URLs and titles that can be fetched individually using the `get_doc_resource` tool.
- **`get_doc_resource`**: Fetches a specific Neon documentation page as markdown content. Use the `list_docs_resources` tool first to discover available page slugs, then pass the slug to this tool.

**Functions** (`?category=functions`):

- **`functions_list`**, **`functions_get`**, **`functions_update`**, **`functions_delete`**, **`functions_deploy`**

**Storage** (`?category=storage`):

- **`storage_buckets_list`**, **`storage_buckets_create`**, **`storage_buckets_delete`**
- **`storage_objects_list`**, **`storage_objects_delete`**, **`storage_objects_delete_by_prefix`**
- **`storage_objects_presign`**, **`storage_get`**

### Migrations

Migrations are a way to manage changes to your database schema over time. With the Neon MCP server, LLMs are empowered to do migrations safely with separate "Start" (`prepare_database_migration`) and "Commit" (`complete_database_migration`) commands.

The "Start" command accepts a migration and runs it in a new temporary branch. Upon returning, this command hints to the LLM that it should test the migration on this branch. The LLM can then run the "Commit" command to apply the migration to the original branch.

## Development

This project uses [pnpm](https://pnpm.io) as the package manager, pinned via Corepack.

### Project Structure

The MCP server code lives at the repository root, a Next.js application deployed to Vercel at `mcp.neon.tech`.

```bash
corepack enable
pnpm install
```

### Local Development

```bash
# Start the Next.js dev server (for the remote MCP server)
pnpm dev
```

### Linting and Type Checking

```bash
pnpm lint
pnpm typecheck
```

### Environment Variables

Required for remote server runtime:

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

### Testing Pyramid

All tests run from the repository root.

```bash
# Unit tests
pnpm test:unit

# Integration tests
pnpm test:integration

# MCP protocol end-to-end tests (real MCP client/server tool calls)
pnpm test:e2e:mcp

# Website end-to-end tests (Playwright; provisions/validates ephemeral DB first)
pnpm test:e2e:web

# Full end-to-end suite
pnpm test:e2e

# Full test pyramid (unit + integration + e2e; used in CI)
pnpm test
```

Testing strategy:

- Prefer **E2E** for transport/protocol and user-visible behavior.
- Use **integration** tests for deterministic tool contracts and workflow behavior.
- Use **unit** tests for pure logic and edge cases.
- Avoid relying on third-party uptime in merge-gating tests; mock external dependencies in integration/unit tiers.

### Deployment

Vercel deploys the remote server automatically from the repository branch configuration. Preview environments are available for pull requests.
