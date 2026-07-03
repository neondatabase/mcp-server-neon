# Smoke Tests (Agent-Driven)

This document defines a repeatable smoke-test flow for the Neon MCP server. Use this when validating end-to-end MCP tool behavior after server changes.

## Prerequisites

- Verify the current PR has the `deploy-preview` label (is assigned to the preview environment).
- Verify the `neon-preview` MCP server is configured. Preview base URL is `https://preview-mcp.neon.tech/mcp`.

## Quick Test

The `/api/list-tools` endpoint accepts the same query params and returns the resolved grant, read-only state, and visible tools — no auth required:

```bash
# Full access (29 tools)
curl https://mcp.neon.tech/api/list-tools

# Read-only (18 tools)
curl "https://mcp.neon.tech/api/list-tools?readonly=true"

# Querying category only (10 tools)
curl "https://mcp.neon.tech/api/list-tools?category=querying"

# Project-scoped (22 tools, no project-agnostic tools)
curl "https://mcp.neon.tech/api/list-tools?projectId=proj-123"
```

This is a quick way to verify that the MCP server is configured correctly and that the tools are available.

## True MCP Server Test

### Safety Rules

- Run all tests only against `neon-preview` (staging account).
- The `neon` MCP server is production. Never run destructive cleanup calls (`delete_branch`, `delete_project`) on production resources (the `neon` MCP server) only against `neon-preview`.
- Use clearly prefixed temporary resource names, e.g. `manual-smoke-YYYY-MM-DD`.

### Server Configuration

Grant context (read-only mode, scope categories, project scoping) is configured via URL query params on the MCP server URL. Config travels with every request — no custom HTTP headers required.

#### URL Query Params

| Param       | Description                                    | Example                              |
| ----------- | ---------------------------------------------- | ------------------------------------ |
| `readonly`  | Enable read-only mode (`true`/`false`)         | `?readonly=true`                     |
| `category`  | Scope categories (repeated or comma-separated) | `?category=querying&category=schema` |
| `projectId` | Scope to a single project                      | `?projectId=proj-123`                |

#### Example MCP Client Configs

**Full access (default):**

```json
{ "url": "https://mcp.neon.tech/mcp" }
```

**Read-only + project-scoped:**

```json
{
  "url": "https://mcp.neon.tech/mcp?readonly=true&projectId=steep-forest-57233818"
}
```

**Category-filtered (querying + schema only):**

```json
{ "url": "https://mcp.neon.tech/mcp?category=querying&category=schema" }
```

**Preview server, read-only:**

```json
{ "url": "https://preview-mcp.neon.tech/mcp?readonly=true" }
```

## Smoke Test Plan

Follow these phases in order. Each phase builds on the previous one.

### Phase 1: Inspect Current Configuration

1. Read the MCP client config file (e.g. `.cursor/mcp.json`, `.codex/config_proj.toml`) to find the `neon-preview` server entry.
2. Report the current URL, noting which query params are set (`readonly`, `category`, `projectId`) and any legacy headers.
3. Determine what behavior to expect from this config:
   - Which tools should be visible (e.g. 29 for full access, 18 for read-only, fewer for category-filtered).
   - Whether write tools should be available.
   - Whether project-agnostic tools (`list_projects`, `create_project`, `search`, `fetch`) should be hidden.

### Phase 2: Validate Tool Visibility

1. Call `neon-preview.list_projects` (or any read-safe tool) to confirm auth works.
2. Verify the tool surface matches expectations from Phase 1:
   - If `readonly=true`: confirm write tools (e.g. `create_project`, `create_branch`, `prepare_database_migration`) are NOT available.
   - If `category` is set: confirm only tools in those categories are available.
   - If `projectId` is set: confirm `list_projects`, `create_project`, `delete_project`, `list_organizations`, `list_shared_projects`, `search`, and `fetch` are NOT available.
   - If no params: confirm all 29 tools are available.
3. Try calling a tool that should NOT be available given the config. Confirm it fails or is absent.

### Phase 3: Exercise Available Tools

Run through the applicable subset of these tests based on the current config. Skip tests for tools that are correctly filtered out.

**Discovery / Auth Sanity:**
- `neon-preview.list_organizations`
- `neon-preview.list_projects`

**Project Lifecycle** (skip if read-only or project-scoped):
- `neon-preview.create_project` with name `manual-smoke-YYYY-MM-DD`
- `neon-preview.list_projects` with `search`
- `neon-preview.describe_project`

**Branch Lifecycle** (skip if read-only):
- `neon-preview.create_branch` (e.g. `smoke-child`)
- `neon-preview.describe_branch` for main and child

**SQL + Schema Basics:**
- `neon-preview.run_sql` (create test table — skip CREATE if read-only, use SELECT instead)
- `neon-preview.run_sql_transaction` (skip if read-only)
- `neon-preview.run_sql` (select validation)
- `neon-preview.get_database_tables`
- `neon-preview.describe_table_schema`
- `neon-preview.explain_sql_statement`

**Schema Diff:**
- On child branch only: `neon-preview.run_sql` to create a child-only object
- `neon-preview.compare_database_schema` using the child branch

**Migration Flow** (skip if read-only):
- `neon-preview.prepare_database_migration`
- Validate in temporary branch with `neon-preview.run_sql`
- `neon-preview.complete_database_migration` (apply or discard)

**Query Tuning Flow** (skip if read-only):
- `neon-preview.prepare_query_tuning`
- `neon-preview.complete_query_tuning` (usually discard for smoke tests)

**Discovery + Docs Tools:**
- `neon-preview.search`
- `neon-preview.fetch`
- `neon-preview.list_docs_resources`
- `neon-preview.get_doc_resource`

**Performance Tool Check:**
- `neon-preview.list_slow_queries`

**Read-Only Connection String Guard** (only when `readonly=true`):
- `neon-preview.get_connection_string` against a branch with a read replica endpoint
- `neon-preview.get_connection_string` against a branch without a read replica endpoint
- With a read replica: expect URI bound to a `read_only` endpoint.
- Without a read replica: expect failure with guidance to create a read replica.

### Phase 4: Cleanup

- `neon-preview.delete_branch` for any test child branch(es) created
- `neon-preview.delete_project` for any test project created
- `neon-preview.list_projects` with `search` to verify cleanup
- Skip if no resources were created (e.g. read-only config).

### Phase 5: Report Results for This Configuration

After completing Phases 1–4, produce a report for the current config:

```
Configuration: <URL with query params>
  readonly: <true/false>
  category: <list or "all">
  projectId: <id or "none">

Tool visibility: <PASS/FAIL> — expected N tools, saw N tools
  [details of any mismatches]

Tool calls:
  - <tool_name>: PASS
  - <tool_name>: PASS
  - <tool_name>: FAIL — <error details>
  ...

Cleanup: <completed / skipped / partial>
```

Record any failures with tool name, input args (redact secrets), exact error text, and whether the failure reproduced on retry.

### Phase 6: Prompt for Next Configuration

After reporting results, suggest the next configuration to test. Cycle through these combinations:

1. **Full access** (no query params) — if not already tested
2. **Read-only** (`?readonly=true`) — if not already tested
3. **Project-scoped** (`?projectId=<id>`) — if not already tested
4. **Category-filtered** (`?category=querying`) — if not already tested
5. **Combined** (`?readonly=true&projectId=<id>&category=querying,schema`) — if not already tested

For each suggestion:

1. Tell the user exactly what to change in their MCP config file (show the full URL).
2. **Wait for the user to confirm they have updated the config and reconnected the MCP server.** Do not proceed until the user confirms.
3. Once confirmed, go back to Phase 1 and repeat the full cycle.

### Phase 7: Final Report

After all configurations have been tested (or the user says they are done), produce a consolidated report:

```
=== Neon MCP Server Smoke Test Report ===
Date: YYYY-MM-DD
Environment: neon-preview (preview-mcp.neon.tech)

Configuration 1: <URL>
  Tool visibility: PASS/FAIL
  Tool calls: X/Y passed
  Errors: <none or list>

Configuration 2: <URL>
  Tool visibility: PASS/FAIL
  Tool calls: X/Y passed
  Errors: <none or list>

...

Overall: X/Y configurations fully passed
Errors requiring attention:
  - [Config N] <tool_name>: <error summary>
```

### Failure Handling

- If a step fails, capture: tool name, input args (redact secrets), exact error text, whether failure reproduces on retry.
- Stop destructive follow-up steps if identity/account context is unclear.
- Confirm server/environment alignment (`neon-preview` vs `neon`) before continuing.
- Continue to the next test within the phase — do not abort the entire run for a single tool failure.
