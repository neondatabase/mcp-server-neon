<img width="250px" src="https://neon.tech/brand/neon-logo-dark-color.svg" />

# Neon MCP Server

**Neon MCP Server** is an open-source tool that lets you interact with your Neon Postgres databases in **natural language**.

[![npm version](https://img.shields.io/npm/v/@neondatabase/mcp-server-neon)](https://www.npmjs.com/package/@neondatabase/mcp-server-neon)
[![npm downloads](https://img.shields.io/npm/dt/@neondatabase/mcp-server-neon)](https://www.npmjs.com/package/@neondatabase/mcp-server-neon)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![smithery badge](https://smithery.ai/badge/neon)](https://smithery.ai/server/neon)

The Model Context Protocol (MCP) is a [new, standardized protocol](https://modelcontextprotocol.io/introduction) designed to manage context between large language models (LLMs) and external systems. This repository offers an installer and an MCP Server for [Neon](https://neon.tech).

Neon's MCP server acts as a bridge between natural language requests and the [Neon API](https://api-docs.neon.tech/reference/getting-started-with-neon-api). Built upon MCP, it translates your requests into the necessary API calls, enabling you to manage tasks such as creating projects and branches, running queries, and performing database migrations seamlessly.

Some of the key features of the Neon MCP server include:

- **Natural language interaction:** Manage Neon databases using intuitive, conversational commands.
- **Simplified database management:** Perform complex actions without writing SQL or directly using the Neon API.
- **Enhanced Productivity:** Streamline workflows for database administration and development.
- **Accessibility for non-developers:** Empower users with varying technical backgrounds to interact with Neon databases.
- **Database migration support:** Leverage Neon's branching capabilities for database schema changes initiated via natural language.

For example, in Claude Desktop, or any MCP Client, you can use natural language to accomplish things with Neon, such as:

- `Let's create a new Postgres database, and call it "my-database". Let's then create a table called users with the following columns: id, name, email, and password.`
- `I want to run a migration on my project called "my-project" that alters the users table to add a new column called "created_at".`
- `Can you give me a summary of all of my Neon projects and what data is in each one?`

> [!NOTE]  
> The Neon MCP server grants powerful database management capabilities through natural language requests.  **Always review and authorize actions** requested by the LLM before execution. Ensure that only authorized users and applications have access to the Neon MCP server and Neon API keys.


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
        "args": [
          "-y",
          "mcp-remote",
          "https://mcp.neon.tech/sse"
        ]
      }
    }
  }
  ```

- Save the configuration file.
- Restart or refresh your MCP client.
- An OAuth window will open in your browser. Follow the prompts to authorize your MCP client to access your Neon account.

### Option 2. Local MCP Server

Run the Neon MCP server on your local machine.

**Setup via Smithery:**

```bash
npx -y @smithery/cli@latest install neon --client <client_name>
```

You will be prompted to enter your Neon API key. Enter the API key which you obtained from the [prerequisites](#prerequisites) section
Replace `<client_name>` with the name of your MCP client application. Supported client names include:
  - `claude` for [Claude Desktop](https://claude.ai/download)
  - `cursor` for [Cursor](https://cursor.com) (Installing via `smithery` makes the MCP server a global MCP server in Cursor)
  - `windsurf` for [Windsurf Editor](https://codeium.com/windsurf)
  - `roo-cline` for [Roo Cline VS Code extension](https://github.com/RooVetGit/Roo-Code)
  - `witsy` for [Witsy](https://witsyai.com/)
  - `enconvo` for [Enconvo](https://www.enconvo.com/)
  - `vscode` for [Visual Studio Code (Preview)](https://code.visualstudio.com/docs/copilot/chat/mcp-servers)

Restart your MCP client after installation.

**Setup via npm**

If your MCP client is not listed here, you can manually add the Neon MCP Server details to your client's `mcp_config` file.

Add the following JSON configuration within the `mcpServers` section of your client's `mcp_config` file, replacing `<YOUR_NEON_API_KEY>` with your actual Neon API key:

```json
{
  "mcpServers": {
    "neon": {
      "command": "npx",
      "args": ["-y", "@neondatabase/mcp-server-neon", "start", "<YOUR_NEON_API_KEY>"]
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
      "args": ["/c", "npx", "-y", "@neondatabase/mcp-server-neon", "start", "<YOUR_NEON_API_KEY>"]
    }
  }
}
```

```json
{
  "mcpServers": {
    "neon": {
      "command": "wsl",
      "args": ["npx", "-y", "@neondatabase/mcp-server-neon", "start", "<YOUR_NEON_API_KEY>"]
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

- **`list_projects`**: Retrieves a list of your Neon projects, providing a summary of each project associated with your Neon account.
- **`describe_project`**: Fetches detailed information about a specific Neon project, including its ID, name, and associated branches and databases.
- **`create_project`**: Creates a new Neon project in your Neon account. A project acts as a container for branches, databases, roles, and computes.
- **`delete_project`**: Deletes an existing Neon project and all its associated resources.

**Branch Management:**

- **`create_branch`**: Creates a new branch within a specified Neon project. Leverages [Neon's branching](/docs/introduction/branching) feature for development, testing, or migrations.
- **`delete_branch`**: Deletes an existing branch from a Neon project.
- **`describe_branch`**: Retrieves details about a specific branch, such as its name, ID, and parent branch.

**SQL Query Execution:**

- **`get_connection_string`**: Returns your database connection string.
- **`run_sql`**: Executes a single SQL query against a specified Neon database. Supports both read and write operations.
- **`run_sql_transaction`**: Executes a series of SQL queries within a single transaction against a Neon database.
- **`get_database_tables`**: Lists all tables within a specified Neon database.
- **`describe_table_schema`**: Retrieves the schema definition of a specific table, detailing columns, data types, and constraints.

**Database Migrations (Schema Changes):**

- **`prepare_database_migration`**: Initiates a database migration process. Critically, it creates a temporary branch to apply and test the migration safely before affecting the main branch.
- **`complete_database_migration`**: Finalizes and applies a prepared database migration to the main branch. This action merges changes from the temporary migration branch and cleans up temporary resources.

**Neon Auth:**
- `provision_neon_auth`: Action to provision Neon Auth for a Neon project. It allows developers to easily setup authentication infrastructure by creating a integration with Stack Auth (`@stackframe/stack`).

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
