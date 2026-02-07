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
- **Fine-grained access control:** Choose a permission preset, scope to a single project, and protect production branches.
- **Database migration support:** Leverage Neon's branching capabilities for database schema changes initiated via natural language.

For example, in Claude Code, or any MCP Client, you can use natural language to accomplish things with Neon, such as:

- `Let's create a new Postgres database, and call it "my-database". Let's then create a table called users with the following columns: id, name, email, and password.`
- `I want to run a migration on my project called "my-project" that alters the users table to add a new column called "created_at".`
- `Can you give me a summary of all of my Neon projects and what data is in each one?`

> [!WARNING]
> **Neon MCP Server Security Considerations**
> The Neon MCP Server grants powerful database management capabilities through natural language requests. **Always review and authorize actions requested by the LLM before execution.** Ensure that only authorized users and applications have access to the Neon MCP Server.
>
> Consider using [permission presets](#permission-presets) and [production branch protection](#production-branch-protection) to limit the blast radius of AI-initiated operations.
>
> For more information, see [MCP security guidance](https://neon.tech/docs/ai/neon-mcp-server#mcp-security-guidance).

For full documentation, visit [neon.com/docs/ai/neon-mcp-server](https://neon.com/docs/ai/neon-mcp-server). The docs include an interactive configurator that lets you select your preferred permission preset, project scoping, and branch protection options and generates the correct MCP client configuration for you.

## Setting up Neon MCP Server

There are a few options for setting up the Neon MCP Server:

1. **Quick Setup with API Key (Cursor, VS Code, and Claude Code):** Run [`neonctl@latest init`](https://neon.com/docs/reference/cli-init) to automatically configure Neon's MCP Server, [agent skills](https://github.com/neondatabase/agent-skills), and VS Code extension with one command.
2. **Remote MCP Server (OAuth Based Authentication):** Connect to Neon's managed MCP server using OAuth for authentication. This method is more convenient as it eliminates the need to manage API keys. Additionally, you will automatically receive the latest features and improvements as soon as they are released.
3. **Remote MCP Server (API Key Based Authentication):** Connect to Neon's managed MCP server using API key for authentication. This method is useful if you want to connect a remote agent to Neon where OAuth is not available. Additionally, you will automatically receive the latest features and improvements as soon as they are released.
4. **Local MCP Server:** Run the Neon MCP server locally on your machine, authenticating with a Neon API key.

All options support [permission presets](#permission-presets), [project scoping](#project-scoping), and [production branch protection](#production-branch-protection).

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

> MCP supports two remote server transports: the deprecated Server-Sent Events (SSE) and the newer, recommended Streamable HTTP. If your LLM client doesn't support Streamable HTTP yet, you can switch the endpoint from `https://mcp.neon.tech/mcp` to `https://mcp.neon.tech/sse` to use SSE instead.

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
- `search`, `fetch`, `load_resource`

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

- [Neon MCP Server Guide](https://neon.com/docs/ai/neon-mcp-server) (includes an interactive configurator for scopes and presets)
- [Connect MCP Clients to Neon](https://neon.com/docs/ai/connect-mcp-clients-to-neon)
- [Cursor with Neon MCP Server](https://neon.tech/guides/cursor-mcp-neon)
- [Claude Desktop with Neon MCP Server](https://neon.tech/guides/neon-mcp-server)
- [Cline with Neon MCP Server](https://neon.tech/guides/cline-mcp-neon)
- [Windsurf with Neon MCP Server](https://neon.tech/guides/windsurf-mcp-neon)
- [Zed with Neon MCP Server](https://neon.tech/guides/zed-mcp-neon)

# Fine-Grained Access Control

The Neon MCP Server supports fine-grained access control through **permission presets**, **project scoping**, **production branch protection**, and **custom scope categories**. These controls let you limit what an AI agent can do, reducing the blast radius of potential mistakes.

Access control can be configured via:

- **HTTP headers** (`X-Neon-*`) for the remote MCP server with API key authentication
- **CLI flags** (`--preset`, `--project-id`, etc.) for the local MCP server
- **OAuth consent UI** when connecting via OAuth (the authorization page lets you select a preset)

> **OAuth vs API key:** When using OAuth, access control settings are locked in during the consent flow and stored with the token. HTTP headers (`X-Neon-*`) are ignored for OAuth-authenticated requests -- to change permissions, re-authenticate through a new OAuth flow. HTTP headers only apply when authenticating with an API key via the `Authorization` header.

## Permission Presets

Presets are predefined access levels that control which tools are available.

| Preset | Description | Write access | Project create/delete | SQL execution |
|---|---|---|---|---|
| `full_access` | No restrictions. Use with caution. | Yes | Yes | Yes |
| `local_development` | Safe development access with branch management and SQL. | Yes | No | Yes |
| `production_use` | Read-only access for schema inspection and documentation. | No | No | Read-only |
| `custom` | Select specific tool categories to enable (see [Custom Scopes](#custom-scope-categories)). | Depends on scopes | Depends on scopes | Depends on scopes |

The default preset is `full_access` when no preset is specified.

### Remote MCP Server with API Key

Set the `X-Neon-Preset` header to choose a preset.

**Local Development preset with `add-mcp`:**

```bash
npx add-mcp@latest https://mcp.neon.tech/mcp \
  --name Neon \
  --header "Authorization: Bearer $NEON_API_KEY" \
  --header "X-Neon-Preset: local_development"
```

**Production Use (read-only) preset with `add-mcp`:**

```bash
npx add-mcp@latest https://mcp.neon.tech/mcp \
  --name Neon \
  --header "Authorization: Bearer $NEON_API_KEY" \
  --header "X-Neon-Preset: production_use"
```

Or use JSON config:

```json
{
  "mcpServers": {
    "Neon": {
      "url": "https://mcp.neon.tech/mcp",
      "headers": {
        "Authorization": "Bearer <NEON_API_KEY>",
        "X-Neon-Preset": "local_development"
      }
    }
  }
}
```

### Local MCP Server

Use the `--preset` flag:

```bash
npx add-mcp@latest @neondatabase/mcp-server-neon \
  --name neon \
  -- start $NEON_API_KEY --preset local_development
```

Or use JSON config:

```json
{
  "mcpServers": {
    "neon": {
      "command": "npx",
      "args": [
        "-y",
        "@neondatabase/mcp-server-neon",
        "start",
        "<YOUR_NEON_API_KEY>",
        "--preset",
        "local_development"
      ]
    }
  }
}
```

### OAuth

When connecting via OAuth, the authorization page presents preset options as radio buttons. Select your preferred preset before approving. Your selection is stored with the OAuth token and cannot be changed via headers afterward -- re-authenticate to change permissions.

## Project Scoping

You can restrict the MCP server to operate on a single Neon project. When project-scoped:

- **Project-agnostic tools are hidden** (`list_projects`, `create_project`, `delete_project`, `list_organizations`, `list_shared_projects`)
- **`projectId` is auto-injected** into all tool calls and removed from schemas visible to the LLM
- The LLM cannot accidentally operate on the wrong project

### Remote MCP Server with API Key

Set the `X-Neon-Project-Id` header.

**Project-scoped with `add-mcp`:**

```bash
npx add-mcp@latest https://mcp.neon.tech/mcp \
  --name Neon \
  --header "Authorization: Bearer $NEON_API_KEY" \
  --header "X-Neon-Project-Id: my-project-abc123" \
  --header "X-Neon-Preset: local_development"
```

Or use JSON config:

```json
{
  "mcpServers": {
    "Neon": {
      "url": "https://mcp.neon.tech/mcp",
      "headers": {
        "Authorization": "Bearer <NEON_API_KEY>",
        "X-Neon-Project-Id": "<NEON_PROJECT_ID>",
        "X-Neon-Preset": "local_development"
      }
    }
  }
}
```

### Local MCP Server

Use the `--project-id` flag:

```bash
npx add-mcp@latest @neondatabase/mcp-server-neon \
  --name neon \
  -- start $NEON_API_KEY --project-id my-project-abc123 --preset local_development
```

Or use JSON config:

```json
{
  "mcpServers": {
    "neon": {
      "command": "npx",
      "args": [
        "-y",
        "@neondatabase/mcp-server-neon",
        "start",
        "<YOUR_NEON_API_KEY>",
        "--project-id",
        "<NEON_PROJECT_ID>",
        "--preset",
        "local_development"
      ]
    }
  }
}
```

## Production Branch Protection

Protect critical branches from destructive operations. When enabled, the MCP server blocks `delete_branch`, `reset_from_parent`, `run_sql`, and `run_sql_transaction` on protected branches.

The `X-Neon-Protect-Production` header (or `--protect-production` CLI flag) supports three formats:

| Value | Behavior |
|---|---|
| `true` | Protects branches named `main`, `master`, `prod`, and `production` |
| `my-branch` | Protects the single branch named `my-branch` |
| `main,staging,prod` | Protects all listed branches (comma-separated) |

### Remote MCP Server with API Key

**Protect default production branches with `add-mcp`:**

```bash
npx add-mcp@latest https://mcp.neon.tech/mcp \
  --name Neon \
  --header "Authorization: Bearer $NEON_API_KEY" \
  --header "X-Neon-Preset: local_development" \
  --header "X-Neon-Protect-Production: true"
```

**Protect specific branches:**

```bash
npx add-mcp@latest https://mcp.neon.tech/mcp \
  --name Neon \
  --header "Authorization: Bearer $NEON_API_KEY" \
  --header "X-Neon-Preset: full_access" \
  --header "X-Neon-Protect-Production: main,staging"
```

Or use JSON config:

```json
{
  "mcpServers": {
    "Neon": {
      "url": "https://mcp.neon.tech/mcp",
      "headers": {
        "Authorization": "Bearer <NEON_API_KEY>",
        "X-Neon-Preset": "local_development",
        "X-Neon-Protect-Production": "true"
      }
    }
  }
}
```

### Local MCP Server

Use the `--protect-production` flag:

```bash
npx add-mcp@latest @neondatabase/mcp-server-neon \
  --name neon \
  -- start $NEON_API_KEY --preset local_development --protect-production
```

Protect specific branches:

```bash
npx add-mcp@latest @neondatabase/mcp-server-neon \
  --name neon \
  -- start $NEON_API_KEY --protect-production main,staging
```

Or use JSON config:

```json
{
  "mcpServers": {
    "neon": {
      "command": "npx",
      "args": [
        "-y",
        "@neondatabase/mcp-server-neon",
        "start",
        "<YOUR_NEON_API_KEY>",
        "--preset",
        "local_development",
        "--protect-production"
      ]
    }
  }
}
```

### OAuth

When connecting via OAuth, check the "Protect production branches" checkbox in the authorization dialog to protect branches named `main`, `master`, `prod`, and `production`.

## Custom Scope Categories

For fine-grained control beyond presets, you can enable specific tool categories using the `custom` preset. When `X-Neon-Scopes` (or `--scopes`) is provided, the preset is automatically set to `custom` regardless of any `X-Neon-Preset` value.

Available scope categories:

| Category | Tools included |
|---|---|
| `projects` | `list_projects`, `create_project`, `delete_project`, `describe_project`, `list_organizations`, `list_shared_projects` |
| `branches` | `create_branch`, `delete_branch`, `describe_branch`, `reset_from_parent`, `list_branch_computes`, `get_connection_string` |
| `schema` | `get_database_tables`, `describe_table_schema` |
| `querying` | `run_sql`, `run_sql_transaction`, `prepare_database_migration`, `complete_database_migration`, `compare_database_schema` |
| `performance` | `explain_sql_statement`, `prepare_query_tuning`, `complete_query_tuning`, `list_slow_queries` |
| `neon_auth` | `provision_neon_auth`, `provision_neon_data_api` |
| `docs` | `load_resource` |

The `search` and `fetch` tools are always available regardless of scope selection.

> **Note:** At least one valid scope category is required for useful access. If `X-Neon-Scopes` is present but contains only invalid values, the `custom` preset is still applied with no categories enabled -- only `search` and `fetch` will be available. Preset values are case-sensitive (e.g., `local_development` is valid, `Local_Development` is not).

### Remote MCP Server with API Key

**Allow only schema inspection and querying with `add-mcp`:**

```bash
npx add-mcp@latest https://mcp.neon.tech/mcp \
  --name Neon \
  --header "Authorization: Bearer $NEON_API_KEY" \
  --header "X-Neon-Scopes: schema,querying"
```

**Allow everything except project management:**

```bash
npx add-mcp@latest https://mcp.neon.tech/mcp \
  --name Neon \
  --header "Authorization: Bearer $NEON_API_KEY" \
  --header "X-Neon-Scopes: branches,schema,querying,performance,neon_auth,docs"
```

Or use JSON config:

```json
{
  "mcpServers": {
    "Neon": {
      "url": "https://mcp.neon.tech/mcp",
      "headers": {
        "Authorization": "Bearer <NEON_API_KEY>",
        "X-Neon-Scopes": "schema,querying"
      }
    }
  }
}
```

### Local MCP Server

Use the `--scopes` flag:

```bash
npx add-mcp@latest @neondatabase/mcp-server-neon \
  --name neon \
  -- start $NEON_API_KEY --scopes schema,querying
```

Or use JSON config:

```json
{
  "mcpServers": {
    "neon": {
      "command": "npx",
      "args": [
        "-y",
        "@neondatabase/mcp-server-neon",
        "start",
        "<YOUR_NEON_API_KEY>",
        "--scopes",
        "schema,querying"
      ]
    }
  }
}
```

## Combining Options

All access control options can be combined. Here are some common configurations:

### Safe Development Environment

Scope to a single project, allow development operations, and protect production branches:

```bash
npx add-mcp@latest https://mcp.neon.tech/mcp \
  --name Neon \
  --header "Authorization: Bearer $NEON_API_KEY" \
  --header "X-Neon-Preset: local_development" \
  --header "X-Neon-Project-Id: my-project-abc123" \
  --header "X-Neon-Protect-Production: true"
```

```json
{
  "mcpServers": {
    "Neon": {
      "url": "https://mcp.neon.tech/mcp",
      "headers": {
        "Authorization": "Bearer <NEON_API_KEY>",
        "X-Neon-Preset": "local_development",
        "X-Neon-Project-Id": "<NEON_PROJECT_ID>",
        "X-Neon-Protect-Production": "true"
      }
    }
  }
}
```

### Read-Only Schema Inspector

Only allow schema and documentation access on a single project:

```bash
npx add-mcp@latest https://mcp.neon.tech/mcp \
  --name Neon \
  --header "Authorization: Bearer $NEON_API_KEY" \
  --header "X-Neon-Scopes: schema,docs" \
  --header "X-Neon-Project-Id: my-project-abc123"
```

```json
{
  "mcpServers": {
    "Neon": {
      "url": "https://mcp.neon.tech/mcp",
      "headers": {
        "Authorization": "Bearer <NEON_API_KEY>",
        "X-Neon-Scopes": "schema,docs",
        "X-Neon-Project-Id": "<NEON_PROJECT_ID>"
      }
    }
  }
}
```

### Full Access with Branch Protection (Local)

Full access but protect `main` and `staging` branches from destructive operations:

```bash
npx add-mcp@latest @neondatabase/mcp-server-neon \
  --name neon \
  -- start $NEON_API_KEY --protect-production main,staging
```

```json
{
  "mcpServers": {
    "neon": {
      "command": "npx",
      "args": [
        "-y",
        "@neondatabase/mcp-server-neon",
        "start",
        "<YOUR_NEON_API_KEY>",
        "--protect-production",
        "main,staging"
      ]
    }
  }
}
```

## Read-Only Mode

Use the `X-Neon-Read-Only` header to explicitly enable or disable read-only mode. This takes the highest priority over all other access control settings, including presets and OAuth scopes.

This is particularly useful in combination with the `custom` preset and `X-Neon-Scopes`: custom scopes control **which** tool categories are available, while `X-Neon-Read-Only` controls **whether** write tools within those categories are included.

### Remote MCP Server with API Key

**Read-only with custom scopes (only schema and querying read tools):**

```bash
npx add-mcp@latest https://mcp.neon.tech/mcp \
  --name Neon \
  --header "Authorization: Bearer $NEON_API_KEY" \
  --header "X-Neon-Scopes: schema,querying" \
  --header "X-Neon-Read-Only: true"
```

Or use JSON config:

```json
{
  "mcpServers": {
    "Neon": {
      "url": "https://mcp.neon.tech/mcp",
      "headers": {
        "Authorization": "Bearer <NEON_API_KEY>",
        "X-Neon-Scopes": "schema,querying",
        "X-Neon-Read-Only": "true"
      }
    }
  }
}
```

> **Backwards compatibility:** The legacy `x-read-only` header is accepted as a synonym for `X-Neon-Read-Only`. If both are present, `X-Neon-Read-Only` takes priority.

## Access Control Reference

### HTTP Headers (Remote MCP Server)

| Header | Values | Description |
|---|---|---|
| `X-Neon-Preset` | `full_access`, `local_development`, `production_use` | Permission preset |
| `X-Neon-Scopes` | Comma-separated categories | Custom scope categories (overrides preset to `custom`) |
| `X-Neon-Project-Id` | Neon project ID | Scope all operations to a single project |
| `X-Neon-Protect-Production` | `true`, branch name, or comma-separated names | Protect branches from destructive operations |
| `X-Neon-Read-Only` | `true` / `false` | Explicit read-only mode (highest priority). `x-read-only` is accepted as a synonym. |

### CLI Flags (Local MCP Server)

| Flag | Values | Description |
|---|---|---|
| `--preset` | `full_access`, `local_development`, `production_use` | Permission preset |
| `--scopes` | Comma-separated categories | Custom scope categories (overrides preset to `custom`) |
| `--project-id` | Neon project ID | Scope all operations to a single project |
| `--protect-production` | `true` (no value), branch name, or comma-separated names | Protect branches from destructive operations |

### Precedence Rules

**API key mode** (HTTP headers):

1. `X-Neon-Read-Only` header takes the highest priority for read-only determination (the legacy `x-read-only` header is checked next as a synonym)
2. `X-Neon-Scopes` / `--scopes` always overrides `X-Neon-Preset` / `--preset` (implies `custom` preset)
3. `production_use` preset implies read-only mode
4. When no access control headers or flags are provided, the default is `full_access` with no project scoping and no branch protection

**OAuth mode:**

All access control is determined during the OAuth consent flow and stored with the token. HTTP headers are ignored for OAuth-authenticated requests. Read-only mode is determined by the stored OAuth scope and grant preset only.

# Features

## Supported Tools

The Neon MCP Server provides the following actions, which are exposed as "tools" to MCP Clients. You can use these tools to interact with your Neon projects and databases using natural language commands.

**Project Management** (scope: `projects`):

- **`list_projects`**: Lists the first 10 Neon projects in your account, providing a summary of each project. If you can't find a specific project, increase the limit by passing a higher value to the `limit` parameter.
- **`list_shared_projects`**: Lists Neon projects shared with the current user. Supports a search parameter and limiting the number of projects returned (default: 10).
- **`describe_project`**: Fetches detailed information about a specific Neon project, including its ID, name, and associated branches and databases.
- **`create_project`**: Creates a new Neon project in your Neon account. A project acts as a container for branches, databases, roles, and computes.
- **`delete_project`**: Deletes an existing Neon project and all its associated resources.
- **`list_organizations`**: Lists all organizations that the current user has access to. Optionally filter by organization name or ID using the search parameter.

**Branch Management** (scope: `branches`):

- **`create_branch`**: Creates a new branch within a specified Neon project. Leverages [Neon's branching](/docs/introduction/branching) feature for development, testing, or migrations.
- **`delete_branch`**: Deletes an existing branch from a Neon project.
- **`describe_branch`**: Retrieves details about a specific branch, such as its name, ID, and parent branch.
- **`list_branch_computes`**: Lists compute endpoints for a project or specific branch, including compute ID, type, size, last active time, and autoscaling information.
- **`get_connection_string`**: Returns your database connection string.
- **`reset_from_parent`**: Resets the current branch to its parent's state, discarding local changes. Automatically preserves to backup if branch has children, or optionally preserve on request with a custom name.

**Schema and Table Inspection** (scope: `schema`):

- **`get_database_tables`**: Lists all tables within a specified Neon database.
- **`describe_table_schema`**: Retrieves the schema definition of a specific table, detailing columns, data types, and constraints.

**SQL Query Execution and Migrations** (scope: `querying`):

- **`run_sql`**: Executes a single SQL query against a specified Neon database. Supports both read and write operations.
- **`run_sql_transaction`**: Executes a series of SQL queries within a single transaction against a Neon database.
- **`prepare_database_migration`**: Initiates a database migration process. Critically, it creates a temporary branch to apply and test the migration safely before affecting the main branch.
- **`complete_database_migration`**: Finalizes and applies a prepared database migration to the main branch. This action merges changes from the temporary migration branch and cleans up temporary resources.
- **`compare_database_schema`**: Shows the schema diff between the child branch and its parent.

**Query Performance Optimization** (scope: `performance`):

- **`list_slow_queries`**: Identifies performance bottlenecks by finding the slowest queries in a database. Requires the pg_stat_statements extension.
- **`explain_sql_statement`**: Provides detailed execution plans for SQL queries to help identify performance bottlenecks.
- **`prepare_query_tuning`**: Analyzes query performance and suggests optimizations, like index creation. Creates a temporary branch for safely testing these optimizations.
- **`complete_query_tuning`**: Finalizes query tuning by either applying optimizations to the main branch or discarding them. Cleans up the temporary tuning branch.

**Neon Auth** (scope: `neon_auth`):

- **`provision_neon_auth`**: Provisions Neon Auth for a Neon project. It allows developers to easily set up authentication infrastructure by creating an integration with an Auth provider.
- **`provision_neon_data_api`**: Provisions the Neon Data API for HTTP-based database access with optional JWT authentication via Neon Auth or external JWKS providers.

**Search and Discovery** (always available):

- **`search`**: Searches across organizations, projects, and branches matching a query. Returns IDs, titles, and direct links to the Neon Console.
- **`fetch`**: Fetches detailed information about a specific organization, project, or branch using an ID (typically from the search tool).

**Documentation and Resources** (scope: `docs`):

- **`load_resource`**: Loads comprehensive Neon documentation and usage guidelines, including the "neon-get-started" guide for setup, configuration, and best practices.

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

# Run the CLI with access control flags
bun run start:cli $NEON_API_KEY -- --preset local_development --project-id my-project --protect-production
```

## Linting and Type Checking

```bash
bun run lint
bun run typecheck
```

## Testing with Claude Desktop

1. Build the CLI: `bun run build:cli`
2. Configure Claude Desktop to use your local build
3. Restart Claude Desktop after each rebuild
