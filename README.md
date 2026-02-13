<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://neon.com/brand/neon-logo-dark-color.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://neon.com/brand/neon-logo-light-color.svg">
  <img width="250px" alt="Neon Logo fallback" src="https://neon.com/brand/neon-logo-dark-color.svg">
</picture>

# Neon MCP Server

[![Install MCP Server in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en-US/install-mcp?name=Neon&config=eyJ1cmwiOiJodHRwczovL21jcC5uZW9uLnRlY2gvbWNwIn0%3D)

**Neon MCP Server** is an open-source tool that lets you interact with your Neon Postgres databases in **natural language**.

[![npm version](https://img.shields.io/npm/v/@neondatabase/mcp-server-neon)](https://www.npmjs.com/package/@neondatabase/mcp-server-neon)
[![npm downloads](https://img.shields.io/npm/dt/@neondatabase/mcp-server-neon)](https://www.npmjs.com/package/@neondatabase/mcp-server-neon)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

The Model Context Protocol (MCP) is a [standardized protocol](https://modelcontextprotocol.io/introduction) designed to manage context between large language models (LLMs) and external systems. This repository offers an installer and an MCP Server for [Neon](https://neon.tech).

Neon's MCP server acts as a bridge between natural language requests and the [Neon API](https://api-docs.neon.tech/reference/getting-started-with-neon-api). Built upon MCP, it translates your requests into the necessary API calls, enabling you to manage tasks such as creating projects and branches, running queries, and performing database migrations seamlessly.

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
> For more information, see [MCP security guidance →](https://neon.tech/docs/ai/neon-mcp-server#mcp-security-guidance).

## Setting up Neon MCP Server

There are a few options for setting up the Neon MCP Server:

1. **Quick Setup with API Key (Cursor, VS Code, and Claude Code):** Run [`neonctl@latest init`](https://neon.com/docs/reference/cli-init) to automatically configure Neon's MCP Server, [agent skills](https://github.com/neondatabase/agent-skills), and VS Code extension with one command.
2. **Remote MCP Server (OAuth Based Authentication):** Connect to Neon's managed MCP server using OAuth for authentication. This method is more convenient as it eliminates the need to manage API keys. Additionally, you will automatically receive the latest features and improvements as soon as they are released.
3. **Remote MCP Server (API Key Based Authentication):** Connect to Neon's managed MCP server using API key for authentication. This method is useful if you want to connect a remote agent to Neon where OAuth is not available. Additionally, you will automatically receive the latest features and improvements as soon as they are released.
4. **Local MCP Server:** Run the Neon MCP server locally on your machine, authenticating with a Neon API key.

### Prerequisites

- An MCP Client application.
- A [Neon account](https://console.neon.tech/signup).
- **Node.js (>= v18.0.0):** Download from [nodejs.org](https://nodejs.org).

For Local MCP Server setup, you also need a Neon API key. See [Neon API Keys documentation](https://neon.tech/docs/manage/api-keys) for instructions on generating one.

For development, you'll also need [Bun](https://bun.sh) installed.

### Option 1. Quick Setup with API Key

**Don't want to manually create an API key?**

Run [`neonctl@latest init`](https://neon.com/docs/reference/cli-init) to automatically configure Neon's MCP Server with one command:

```bash
npx neonctl@latest init
```

This works with Cursor, VS Code (GitHub Copilot), and Claude Code. It will authenticate via OAuth, create a Neon API key for you, and configure your editor automatically.

### Option 2. Remote Hosted MCP Server (OAuth Based Authentication)

Connect to Neon's managed MCP server using OAuth for authentication. This is the easiest setup, requires no local installation of this server, and doesn't need a Neon API key configured in the client.

Run the following command to add the Neon MCP Server for all detected agents and editors in your workspace:

```bash
npx add-mcp https://mcp.neon.tech/mcp
```

Alternatively, you can add the following "Neon" entry to your client's MCP server configuration file (e.g., `mcp.json`, `mcp_config.json`):

```json
{
  "mcpServers": {
    "Neon": {
      "type": "http",
      "url": "https://mcp.neon.tech/mcp"
    }
  }
}
```

- Restart or refresh your MCP client.
- An OAuth window will open in your browser. Follow the prompts to authorize your MCP client to access your Neon account.

> With OAuth-based authentication, the MCP server will, by default, operate on projects under your personal Neon account. To access or manage projects that belong to an organization, you must explicitly provide either the `org_id` or the `project_id` in your prompt to MCP client.

### Option 3. Remote Hosted MCP Server (API Key Based Authentication)

Remote MCP Server also supports authentication using an API key in the `Authorization` header if your client supports it.

[Create a Neon API key](https://console.neon.tech/app/settings?modal=create_api_key) in the Neon Console. Next, run the following command to add the Neon MCP Server for all detected agents and editors in your workspace:

```bash
npx add-mcp https://mcp.neon.tech/mcp --header "Authorization: Bearer <$NEON_API_KEY>"
```

Alternatively, you can add the following "Neon" entry to your client's MCP server configuration file (e.g., `mcp.json`, `mcp_config.json`):

```json
{
  "mcpServers": {
    "Neon": {
      "type": "http",
      "url": "https://mcp.neon.tech/mcp",
      "headers": {
        "Authorization": "Bearer <$NEON_API_KEY>"
      }
    }
  }
}
```

> Provide an organization's API key to limit access to projects under the organization only.

### Option 4. Local MCP Server

Run the Neon MCP server on your local machine with your Neon API key. This method allows you to manage your Neon projects and databases without relying on a remote MCP server.

[Create a Neon API key](https://console.neon.tech/app/settings?modal=create_api_key) in the Neon Console. Next, add the following JSON configuration within the `mcpServers` section of your client's `mcp_config` file, replacing `<YOUR_NEON_API_KEY>` with your actual Neon API key:

```json
{
  "mcpServers": {
    "neon": {
      "command": "npx",
      "args": [
        "-y",
        "@neondatabase/mcp-server-neon",
        "start",
        "<YOUR_NEON_API_KEY>"
      ]
    }
  }
}
```

### Read-Only Mode

**Read-Only Mode:** Restricts which tools are available, disabling write operations like creating projects, branches, or running migrations. Read-only tools include listing projects, describing schemas, querying data, and viewing performance metrics.

You can enable read-only mode in two ways:

1. **OAuth Scope Selection (Recommended):** When connecting via OAuth, uncheck "Full access" during authorization to operate in read-only mode.
2. **Header Override:** Add the `x-read-only` header to your configuration:

```json
{
  "mcpServers": {
    "Neon": {
      "url": "https://mcp.neon.tech/mcp",
      "headers": {
        "x-read-only": "true"
      }
    }
  }
}
```

> **Note:** Read-only mode restricts which _tools_ are available, not the SQL content. The `run_sql` tool remains available and can execute any SQL including INSERT/UPDATE/DELETE. For true read-only SQL access, use database roles with restricted permissions.

<details>
<summary><strong>Tools available in read-only mode</strong></summary>

- `list_projects`, `list_shared_projects`, `describe_project`, `list_organizations`
- `describe_branch`, `list_branch_computes`, `compare_database_schema`
- `run_sql`, `run_sql_transaction`, `get_database_tables`, `describe_table_schema`
- `list_slow_queries`, `explain_sql_statement`
- `get_connection_string`
- `search`, `fetch`, `list_docs_resources`, `get_doc_resource`

**Tools requiring write access:**

- `create_project`, `delete_project`
- `create_branch`, `delete_branch`, `reset_from_parent`
- `provision_neon_auth`, `provision_neon_data_api`
- `prepare_database_migration`, `complete_database_migration`
- `prepare_query_tuning`, `complete_query_tuning`

</details>

### Server-Sent Events (SSE) Transport (Deprecated)

MCP supports two remote server transports: the deprecated Server-Sent Events (SSE) and the newer, recommended Streamable HTTP. If your LLM client doesn't support Streamable HTTP yet, you can switch the endpoint from `https://mcp.neon.tech/mcp` to `https://mcp.neon.tech/sse` to use SSE instead.

Run the following command to add the Neon MCP Server for all detected agents and editors in your workspace using the SSE transport:

```bash
npx add-mcp https://mcp.neon.tech/sse --type sse
```

### Troubleshooting

If your client does not use `JSON` for configuration of MCP servers (such as older versions of Cursor), you can use the following command when prompted:

```bash
npx -y @neondatabase/mcp-server-neon start <YOUR_NEON_API_KEY>
```

#### Troubleshooting on Windows

If you are using Windows and encounter issues while adding the MCP server, you might need to use the Command Prompt (`cmd`) or Windows Subsystem for Linux (`wsl`) to run the necessary commands. Your configuration setup may resemble the following:

```json
{
  "mcpServers": {
    "neon": {
      "command": "cmd",
      "args": [
        "/c",
        "npx",
        "-y",
        "@neondatabase/mcp-server-neon",
        "start",
        "<YOUR_NEON_API_KEY>"
      ]
    }
  }
}
```

```json
{
  "mcpServers": {
    "neon": {
      "command": "wsl",
      "args": [
        "npx",
        "-y",
        "@neondatabase/mcp-server-neon",
        "start",
        "<YOUR_NEON_API_KEY>"
      ]
    }
  }
}
```

## Guides

- [Neon MCP Server Guide](https://neon.tech/docs/ai/neon-mcp-server)
- [Connect MCP Clients to Neon](https://neon.tech/docs/ai/connect-mcp-clients-to-neon)
- [Cursor with Neon MCP Server](https://neon.tech/guides/cursor-mcp-neon)
- [Claude Desktop with Neon MCP Server](https://neon.tech/guides/neon-mcp-server)
- [Cline with Neon MCP Server](https://neon.tech/guides/cline-mcp-neon)
- [Windsurf with Neon MCP Server](https://neon.tech/guides/windsurf-mcp-neon)
- [Zed with Neon MCP Server](https://neon.tech/guides/zed-mcp-neon)

# Features

## Supported Tools

The Neon MCP Server provides the following actions, which are exposed as "tools" to MCP Clients. You can use these tools to interact with your Neon projects and databases using natural language commands.

**Project Management:**

- **`list_projects`**: Lists the first 10 Neon projects in your account, providing a summary of each project. If you can't find a specific project, increase the limit by passing a higher value to the `limit` parameter.
- **`list_shared_projects`**: Lists Neon projects shared with the current user. Supports a search parameter and limiting the number of projects returned (default: 10).
- **`describe_project`**: Fetches detailed information about a specific Neon project, including its ID, name, and associated branches and databases.
- **`create_project`**: Creates a new Neon project in your Neon account. A project acts as a container for branches, databases, roles, and computes.
- **`delete_project`**: Deletes an existing Neon project and all its associated resources.
- **`list_organizations`**: Lists all organizations that the current user has access to. Optionally filter by organization name or ID using the search parameter.

**Branch Management:**

- **`create_branch`**: Creates a new branch within a specified Neon project. Leverages [Neon's branching](/docs/introduction/branching) feature for development, testing, or migrations.
- **`delete_branch`**: Deletes an existing branch from a Neon project.
- **`describe_branch`**: Retrieves details about a specific branch, such as its name, ID, and parent branch.
- **`list_branch_computes`**: Lists compute endpoints for a project or specific branch, including compute ID, type, size, last active time, and autoscaling information.
- **`compare_database_schema`**: Shows the schema diff between the child branch and its parent
- **`reset_from_parent`**: Resets the current branch to its parent's state, discarding local changes. Automatically preserves to backup if branch has children, or optionally preserve on request with a custom name.

**SQL Query Execution:**

- **`get_connection_string`**: Returns your database connection string.
- **`run_sql`**: Executes a single SQL query against a specified Neon database. Supports both read and write operations.
- **`run_sql_transaction`**: Executes a series of SQL queries within a single transaction against a Neon database.
- **`get_database_tables`**: Lists all tables within a specified Neon database.
- **`describe_table_schema`**: Retrieves the schema definition of a specific table, detailing columns, data types, and constraints.

**Database Migrations (Schema Changes):**

- **`prepare_database_migration`**: Initiates a database migration process. Critically, it creates a temporary branch to apply and test the migration safely before affecting the main branch.
- **`complete_database_migration`**: Finalizes and applies a prepared database migration to the main branch. This action merges changes from the temporary migration branch and cleans up temporary resources.

**Query Performance Optimization:**

- **`list_slow_queries`**: Identifies performance bottlenecks by finding the slowest queries in a database. Requires the pg_stat_statements extension.
- **`explain_sql_statement`**: Provides detailed execution plans for SQL queries to help identify performance bottlenecks.
- **`prepare_query_tuning`**: Analyzes query performance and suggests optimizations, like index creation. Creates a temporary branch for safely testing these optimizations.
- **`complete_query_tuning`**: Finalizes query tuning by either applying optimizations to the main branch or discarding them. Cleans up the temporary tuning branch.

**Neon Auth:**

- **`provision_neon_auth`**: Provisions Neon Auth for a Neon project. It allows developers to easily set up authentication infrastructure by creating an integration with an Auth provider.

**Neon Data API:**

- **`provision_neon_data_api`**: Provisions the Neon Data API for HTTP-based database access with optional JWT authentication via Neon Auth or external JWKS providers.

**Search and Discovery:**

- **`search`**: Searches across organizations, projects, and branches matching a query. Returns IDs, titles, and direct links to the Neon Console.
- **`fetch`**: Fetches detailed information about a specific organization, project, or branch using an ID (typically from the search tool).

**Documentation and Resources:**

- **`list_docs_resources`**: Lists all available Neon documentation pages by fetching the index from `https://neon.com/docs/llms.txt`. Returns page URLs and titles that can be fetched individually using the `get_doc_resource` tool.
- **`get_doc_resource`**: Fetches a specific Neon documentation page as markdown content. Use the `list_docs_resources` tool first to discover available page slugs, then pass the slug to this tool.

## Migrations

Migrations are a way to manage changes to your database schema over time. With the Neon MCP server, LLMs are empowered to do migrations safely with separate "Start" (`prepare_database_migration`) and "Commit" (`complete_database_migration`) commands.

The "Start" command accepts a migration and runs it in a new temporary branch. Upon returning, this command hints to the LLM that it should test the migration on this branch. The LLM can then run the "Commit" command to apply the migration to the original branch.

# Development

This project uses [Bun](https://bun.sh) as the package manager and runtime.

## Project Structure

The MCP server code lives in the `landing/` directory, which is a Next.js application deployed to Vercel. The same codebase also produces the CLI published to npm as `@neondatabase/mcp-server-neon`.

```bash
cd landing
bun install
```

## Local Development

```bash
# Start the Next.js dev server (for the remote MCP server)
bun run dev

# Build the CLI for local testing
bun run build:cli

# Run the CLI locally
bun run start:cli $NEON_API_KEY
```

## Linting and Type Checking

```bash
bun run lint
bun run typecheck
```

## Testing Pyramid

All tests run from `landing/`.

```bash
cd landing

# Unit tests
bun run test:unit

# Integration tests
bun run test:integration

# MCP protocol end-to-end tests (real MCP client/server tool calls)
bun run test:e2e:mcp

# Website end-to-end tests (Playwright)
bun run test:e2e:web

# Full end-to-end suite
bun run test:e2e

# Full test pyramid (unit + integration + e2e)
bun run test:all
```

Testing strategy:

- Prefer **E2E** for transport/protocol and user-visible behavior.
- Use **integration** tests for deterministic tool contracts and workflow behavior.
- Use **unit** tests for pure logic and edge cases.
- Avoid relying on third-party uptime in merge-gating tests; mock external dependencies in integration/unit tiers.

## Testing with Claude Desktop

1. Build the CLI: `bun run build:cli`
2. Configure Claude Desktop to use your local build
3. Restart Claude Desktop after each rebuild
