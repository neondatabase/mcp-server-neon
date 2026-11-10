# Contributing

Development commands, architecture, and how to add tools are in [AGENTS.md](./AGENTS.md).

## Which layer a change belongs in

This server is one consumer of [`neondatabase/neon-pkgs`](https://github.com/neondatabase/neon-pkgs). It serves every tool from `@neon/tools`, which Mastra and Eve adapters also use, and `@neon/tools` calls the Neon API through `@neon/sdk`, which the `neon` CLI also uses.

Before changing behavior here, check whether it belongs upstream, where more consumers get it:

| Change                                                                                                                                          | Where                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| How an API call behaves for every caller: error mapping and messages, retries, readiness waits, pagination                                      | `@neon/sdk` ergonomic layer |
| What a tool does and what an agent sees for it: implementation, description, argument schema, result shape                                      | `@neon/tools`               |
| MCP transport, OAuth and consent, grants and tool filtering, pinned MCP names, MCP-only description notes, result rendering, hosting, analytics | this repository             |

Name the chosen layer and the reason in the PR. Keep a change here when it is specific to this server; don't add a shared abstraction for a consumer that doesn't exist yet.

## Read-only tools

Tools marked `readOnlySafe: true` are the only tools registered in read-only mode. For SQL tools the flag is stated per tool in `CUSTOM_TOOL_GRANTS` (`mcp/tools/operations.ts`); their `metadata.method` is `"SQL"` either way. A read-only tool that runs caller-supplied SQL must run exactly one caller-supplied statement, as a prepared query, in its own `READ ONLY` transaction, as `run_sql` does. `run_sql_transaction` is not read-only safe: its statements share one transaction, so a `COMMIT` or `SET TRANSACTION READ WRITE` statement can end the transaction or switch it to read-write.

`describe_branch` reads the database structure with one fixed `SELECT` over the system catalogs, also in a `READ ONLY` transaction. Do not create helper objects to serve a read.

## Tool arguments

Every MCP tool argument is `snake_case`. Published schemas reject unknown keys: camelCase aliases (`projectId`) fail validation. URL grant query params stay camelCase (`?projectId=`, `?category=`, `?readonly=`) because those strings are already in issued OAuth grants and installed MCP URLs.
