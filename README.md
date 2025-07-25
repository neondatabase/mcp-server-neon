<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://neon.com/brand/neon-logo-dark-color.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://neon.com/brand/neon-logo-light-color.svg">
  <img width="250px" alt="Neon Logo fallback" src="https://neon.com/brand/neon-logo-dark-color.svg">
</picture>

# Neon MCP Server

[![Install MCP Server in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/install-mcp?name=Neon&config=eyJ1cmwiOiJodHRwczovL21jcC5uZW9uLnRlY2gvc3NlIn0%3D)

**Neon MCP Server** is an open-source tool that lets you interact with your Neon Postgres databases in **natural language**.

[![npm version](https://img.shields.io/npm/v/@neondatabase/mcp-server-neon)](https://www.npmjs.com/package/@neondatabase/mcp-server-neon)
[![npm downloads](https://img.shields.io/npm/dt/@neondatabase/mcp-server-neon)](https://www.npmjs.com/package/@neondatabase/mcp-server-neon)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

The Model Context Protocol (MCP) is a [new, standardized protocol](https://modelcontextprotocol.io/introduction) designed to manage context between large language models (LLMs) and external systems. This repository offers an installer and an MCP Server for [Neon](https://neon.tech).

Neon's MCP server acts as a bridge between natural language requests and the [Neon API](https://api-docs.neon.tech/reference/getting-started-with-neon-api). Built upon MCP, it translates your requests into the necessary API calls, enabling you to manage tasks such as creating projects and branches, running queries, and performing database migrations seamlessly.

Some of the key features of the Neon MCP server include:

- **Natural language interaction:** Manage Neon databases using intuitive, conversational commands.
- **Simplified database management:** Perform complex actions without writing SQL or directly using the Neon API.
- **Accessibility for non-developers:** Empower users with varying technical backgrounds to interact with Neon databases.
- **Database migration support:** Leverage Neon's branching capabilities for database schema changes initiated via natural language.

For example, in Claude Desktop, or any MCP Client, you can use natural language to accomplish things with Neon, such as:

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

You have two options for connecting your MCP client to Neon:

1. **Remote MCP Server (Preview):** Connect to Neon's managed MCP server using OAuth for authentication. This method is more convenient as it eliminates the need to manage API keys. Additionally, you will automatically receive the latest features and improvements as soon as they are released.

2. **Local MCP Server:** Run the Neon MCP server locally on your machine, authenticating with a Neon API key.

## Prerequisites

- An MCP Client application.
- A [Neon account](https://console.neon.tech/signup).
- **Node.js (>= v18.0.0) and npm:** Download from [nodejs.org](https://nodejs.org).

For Local MCP Server setup, you also need a Neon API key. See [Neon API Keys documentation](https://neon.tech/docs/manage/api-keys) for instructions on generating one.

### Option 1. Remote Hosted MCP Server (Preview)

Connect to Neon's managed MCP server using OAuth for authentication. This is the easiest setup, requires no local installation of this server, and doesn't need a Neon API key configured in the client.

- Add the following "Neon" entry to your client's MCP server configuration file (e.g., `mcp.json`, `mcp_config.json`):

  ```json
  {
    "mcpServers": {
      "Neon": {
        "command": "npx",
        "args": ["-y", "mcp-remote", "https://mcp.neon.tech/mcp"]
      }
    }
  }
  ```

- Save the configuration file.
- Restart or refresh your MCP client.
- An OAuth window will open in your browser. Follow the prompts to authorize your MCP client to access your Neon account.

Note: Neon's Remote MCP Server currently connects only to your personal Neon account. You won't be able to access other Neon organizations. To connect to other organizations, use the Local MCP Server setup described below.

MCP supports two remote server transports: the deprecated Server-Sent Events (SSE) and the newer, recommended Streamable HTTP. If your LLM client doesn't support Streamable HTTP yet, you can switch the endpoint from `https://mcp.neon.tech/mcp` to `https://mcp.neon.tech/sse` to use SSE instead.

### Option 2. Local MCP Server

Run the Neon MCP server on your local machine with your Neon API key. This method allows you to manage your Neon projects and databases without relying on a remote MCP server.

Add the following JSON configuration within the `mcpServers` section of your client's `mcp_config` file, replacing `<YOUR_NEON_API_KEY>` with your actual Neon API key:

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
- **`describe_project`**: Fetches detailed information about a specific Neon project, including its ID, name, and associated branches and databases.
- **`create_project`**: Creates a new Neon project in your Neon account. A project acts as a container for branches, databases, roles, and computes.
- **`delete_project`**: Deletes an existing Neon project and all its associated resources.

**Branch Management:**

- **`create_branch`**: Creates a new branch within a specified Neon project. Leverages [Neon's branching](/docs/introduction/branching) feature for development, testing, or migrations.
- **`delete_branch`**: Deletes an existing branch from a Neon project.
- **`describe_branch`**: Retrieves details about a specific branch, such as its name, ID, and parent branch.
- **`list_branch_computes`**: Lists compute endpoints for a project or specific branch, including compute ID, type, size, and autoscaling information.
- **`list_organizations`**: Lists all organizations that the current user has access to. Optionally filter by organization name or ID using the search parameter.

**SQL Query Execution:**

- **`get_connection_string`**: Returns your database connection string.
- **`run_sql`**: Executes a single SQL query against a specified Neon database. Supports both read and write operations.
- **`run_sql_transaction`**: Executes a series of SQL queries within a single transaction against a Neon database.
- **`get_database_tables`**: Lists all tables within a specified Neon database.
- **`describe_table_schema`**: Retrieves the schema definition of a specific table, detailing columns, data types, and constraints.
- **`list_slow_queries`**: Identifies performance bottlenecks by finding the slowest queries in a database. Requires the pg_stat_statements extension.

**Database Migrations (Schema Changes):**

- **`prepare_database_migration`**: Initiates a database migration process. Critically, it creates a temporary branch to apply and test the migration safely before affecting the main branch.
- **`complete_database_migration`**: Finalizes and applies a prepared database migration to the main branch. This action merges changes from the temporary migration branch and cleans up temporary resources.

**Query Performance Optimization:**

- **`explain_sql_statement`**: Provides detailed execution plans for SQL queries to help identify performance bottlenecks.
- **`prepare_query_tuning`**: Analyzes query performance and suggests optimizations like index creation. Creates a temporary branch for safely testing these optimizations.
- **`complete_query_tuning`**: Applies or discards query optimizations after testing. Can merge changes from the temporary branch to the main branch.
- **`list_slow_queries`**: Identifies and analyzes slow-performing queries in your database. Requires the `pg_stat_statements` extension.

**Compute Management:**

- **`list_branch_computes`**: Lists compute endpoints for a project or specific branch, showing details like compute ID, type, size, and last active time.

**Neon Auth:**

- **`provision_neon_auth`**: Provisions Neon Auth for a Neon project. It allows developers to easily set up authentication infrastructure by creating an integration with Stack Auth (`@stackframe/stack`).

  **Query Performance Tuning:**

- **`explain_sql_statement`**: Analyzes a SQL query and returns detailed execution plan information to help understand query performance.
- **`prepare_query_tuning`**: Identifies potential performance issues in a SQL query and suggests optimizations. Creates a temporary branch for testing improvements.
- **`complete_query_tuning`**: Finalizes and applies query optimizations after testing. Merges changes from the temporary tuning branch to the main branch.

**Neon Auth:**

- **`provision_neon_auth`**: Action to provision Neon Auth for a Neon project. It allows developers to easily setup authentication infrastructure by creating a integration with Stack Auth (`@stackframe/stack`).

## Migrations

Migrations are a way to manage changes to your database schema over time. With the Neon MCP server, LLMs are empowered to do migrations safely with separate "Start" (`prepare_database_migration`) and "Commit" (`complete_database_migration`) commands.

The "Start" command accepts a migration and runs it in a new temporary branch. Upon returning, this command hints to the LLM that it should test the migration on this branch. The LLM can then run the "Commit" command to apply the migration to the original branch.

# Development

## Development with MCP CLI Client

The easiest way to iterate on the MCP Server is using the `mcp-client/`. Learn more in `mcp-client/README.md`.

```bash
npm install
npm run build
npm run watch # You can keep this open.
cd mcp-client/ && NEON_API_KEY=... npm run start:mcp-server-neon
```

## Development with Claude Desktop (Local MCP Server)

```bash
npm install
npm run build
npm run watch # You can keep this open.
node dist/index.js init $NEON_API_KEY
```

Then, **restart Claude** each time you want to test changes.

# Testing

To run the tests you need to setup the `.env` file according to the `.env.example` file.

```bash
npm run test
```
