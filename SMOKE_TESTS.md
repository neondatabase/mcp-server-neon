# Smoke Tests (Agent-Driven)

This document defines a repeatable smoke-test flow for the Neon MCP server using MCP agents.

## Scope

Use this when validating end-to-end MCP tool behavior after server changes (especially auth, grant filtering, routing, and tool wiring).

## Safety Rules

- Run all write/destructive tests only against `neon-preview` (staging account).
- Treat `neon` as production: read-only checks only unless explicitly approved.
- Never run destructive cleanup calls (`delete_branch`, `delete_project`) on production resources.
- Use clearly prefixed temporary resource names, e.g. `manual-smoke-YYYY-MM-DD`.

## Preconditions

- MCP client has both servers configured:
  - `neon-preview` (staging)
  - `neon` (production)
- You can successfully call `list_organizations` on `neon-preview`.

## Smoke Test Plan

## 1) Discovery / Auth Sanity

- `neon-preview.list_organizations`
- `neon-preview.list_projects`

Expected:
- Calls succeed.
- Org/project visibility matches staging account.

## 2) Project Lifecycle

- `neon-preview.create_project` with name `manual-smoke-YYYY-MM-DD`
- `neon-preview.list_projects` with `search`
- `neon-preview.describe_project`

Expected:
- Project is created and returned in list/search.
- `describe_project` returns main/default branch info.

## 3) Branch Lifecycle

- `neon-preview.create_branch` (e.g. `smoke-child`)
- `neon-preview.describe_branch` for main and child

Expected:
- Child branch exists and points to correct parent.

## 4) SQL + Schema Basics

- `neon-preview.run_sql` (create test table)
- `neon-preview.run_sql_transaction` (insert/update)
- `neon-preview.run_sql` (select validation)
- `neon-preview.get_database_tables`
- `neon-preview.describe_table_schema`
- `neon-preview.explain_sql_statement`

Expected:
- SQL executes successfully.
- Data and schema are visible.
- EXPLAIN returns a valid plan.

## 5) Schema Diff

- On child branch only: `neon-preview.run_sql` to create a child-only object
- `neon-preview.compare_database_schema` using the child branch

Expected:
- Non-empty diff between child and parent.

## 6) Migration Flow

- `neon-preview.prepare_database_migration`
- Validate in temporary branch with `neon-preview.run_sql`
- `neon-preview.complete_database_migration` (apply or discard based on test goal)

Expected:
- Migration completes.
- Temporary branch is cleaned up.

## 7) Query Tuning Flow

- `neon-preview.prepare_query_tuning`
- `neon-preview.complete_query_tuning` (usually discard for smoke tests)

Expected:
- Tuning flow completes.
- Temporary branch is cleaned up.

## 8) Discovery + Docs Tools

- `neon-preview.search`
- `neon-preview.fetch`
- `neon-preview.list_docs_resources`
- `neon-preview.get_doc_resource`

Expected:
- Tools return usable data (no auth/routing failures).

## 9) Performance Tool Check

- `neon-preview.list_slow_queries`

Expected:
- Either valid results, or a clear prerequisite error (e.g. missing `pg_stat_statements`).

## 10) Read-Only Connection String Guard

- Enable read-only mode for the MCP server context (HTTP header or OAuth `read` scope)
- `neon-preview.get_connection_string` against a branch that has a read replica endpoint
- `neon-preview.get_connection_string` against a branch that does not have a read replica endpoint

Expected:
- With a read replica: tool returns a URI bound to a `read_only` endpoint.
- Without a read replica: tool fails with guidance to create a read replica (or disable read-only mode).

## 11) Cleanup

- `neon-preview.delete_branch` for test child branch(es)
- `neon-preview.delete_project` for test project
- `neon-preview.list_projects` with `search` to verify cleanup

Expected:
- No leftover smoke-test resources.

## Failure Handling

- If a step fails, capture:
  - tool name
  - input args (redact secrets)
  - exact error text
  - whether failure reproduces on retry
- Stop destructive follow-up steps if identity/account context is unclear.
- Confirm server/environment alignment (`neon-preview` vs `neon`) before continuing.

## Suggested PR Comment Template

Use this summary in PRs:

```md
Smoke test run date: YYYY-MM-DD
Environment: neon-preview (staging)

Pass:
- Discovery/auth sanity
- Project + branch lifecycle
- SQL/schema/explain
- Schema diff
- Migration flow
- Query tuning flow
- Search/fetch/docs

Notes:
- list_slow_queries: <result or prerequisite error>
- Other anomalies: <none | details>

Cleanup:
- Temporary branch deleted: yes/no
- Temporary project deleted: yes/no
```

