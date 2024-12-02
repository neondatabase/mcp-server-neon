# Neon MCP Server

Model Context Protocol (MCP) is a [new, standardized protocol](https://modelcontextprotocol.io/introduction) for managing context between large language models (LLMs) and external systems. In this repository, we provide an installer as well as an MCP Server for [Neon](https://neon.tech).

This lets you use Claude Desktop, or any MCP Client, to use natural language to accomplish things with Neon, e.g.:

* `Let's create a new Postgres database, and call it "my-database". Let's then create a table called users with the following columns: id, name, email, and password.`
* `I want to run a migration on my project called "my-project" that alters the users table to add a new column called "created_at".`
* `Can you give me a summary of all of my Neon projects and what data is in each one?`

# Claude Setup

## Requirements

- Node.js
- Claude Desktop
- Neon API key - you can generate one through the Neon console. [Learn more](https://neon.tech/docs/manage/api-keys#create-an-api-key) or [click here](https://console.neon.tech/app/settings/api-keys) for quick access.

## How to use locally

1. Run `npx git@github.com:neondatabase/mcp-server-neon $NEON_API_KEY`
2. Restart Claude Desktop
3. You should now be able to try a simple command such as `List me all my Neon projects`

# Features

## Supported Commands

* `list_projects`
* `create_project`
* `delete_project`
* `run_sql`
* `get_database_tables`
* `create_branch`
* `start_database_migration`
* `commit_database_migration`

## Migrations

Migrations are a way to manage changes to your database schema over time. With the Neon MCP server, LLMs are empowered to do migrations safely with separate "Start" and "Commit" commands.

The "Start" command accepts a migration and runs it in a new temporary branch. Upon returning, this command hints to the LLM that it should test the migration on this branch. The LLM can then run the "Commit" command to apply the migration to the original branch.

# Development

In the current project folder, run:

```bash
npm install
npm run watch
```

Then, restart Claude each time you want to test changes.