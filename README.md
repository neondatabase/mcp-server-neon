# Neon MCP Server

[![npm version](https://img.shields.io/npm/v/@neondatabase/mcp-server-neon)](https://www.npmjs.com/package/@neondatabase/mcp-server-neon)
[![npm downloads](https://img.shields.io/npm/dt/@neondatabase/mcp-server-neon)](https://www.npmjs.com/package/@neondatabase/mcp-server-neon)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![smithery badge](https://smithery.ai/badge/neon)](https://smithery.ai/server/neon)

Model Context Protocol (MCP) is a [new, standardized protocol](https://modelcontextprotocol.io/introduction) for managing context between large language models (LLMs) and external systems. In this repository, we provide an installer as well as an MCP Server for [Neon](https://neon.tech).

This lets you use Claude Desktop, or any MCP Client, to use natural language to accomplish things with Neon, e.g.:

- `Let's create a new Postgres database, and call it "my-database". Let's then create a table called users with the following columns: id, name, email, and password.`
- `I want to run a migration on my project called "my-project" that alters the users table to add a new column called "created_at".`
- `Can you give me a summary of all of my Neon projects and what data is in each one?`

# Claude Setup

### Installing via Smithery

To install Neon MCP Server for Claude Desktop automatically via [Smithery](https://smithery.ai/server/neon):

```bash
npx -y @smithery/cli install neon --client claude
```

## Requirements

- Node.js >= v18.0.0
- Claude Desktop
- Neon API key - you can generate one through the Neon console. [Learn more](https://neon.tech/docs/manage/api-keys#create-an-api-key) or [click here](https://console.neon.tech/app/settings/api-keys) for quick access.

## How to use locally

1. Run `npx @neondatabase/mcp-server-neon init $NEON_API_KEY`
2. Restart Claude Desktop
3. You should now be able to try a simple command such as `List me all my Neon projects`

## Guides

- [Claude Desktop with Neon MCP Server](https://neon.tech/guides/neon-mcp-server)
- [Cline with Neon MCP Server](https://neon.tech/guides/cline-mcp-neon)
- [Windsurf with Neon MCP Server](https://neon.tech/guides/windsurf-mcp-neon)

# Features

## Supported Tools

- `list_projects`
- `describe_project`
- `create_project`
- `delete_project`

- `create_branch`
- `delete_branch`
- `describe_branch`

- `get_connection_string`
- `run_sql`
- `run_sql_transaction`
- `get_database_tables`
- `describe_table_schema`

- `prepare_database_migration`
- `complete_database_migration`

## Migrations

Migrations are a way to manage changes to your database schema over time. With the Neon MCP server, LLMs are empowered to do migrations safely with separate "Start" and "Commit" commands.

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

## Development with Claude Desktop

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
