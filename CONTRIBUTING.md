# Contributing

Development commands, architecture, and how to add tools are in [AGENTS.md](./AGENTS.md).

## Read-only tools

Tools marked `readOnlySafe: true` are the only tools registered in read-only mode. A read-only tool that runs caller-supplied SQL must run exactly one caller-supplied statement, as a prepared query, in its own `READ ONLY` transaction, as `run_sql` does. `run_sql_transaction` is not read-only safe: its statements share one transaction, so a `COMMIT` or `SET TRANSACTION READ WRITE` statement can end the transaction or switch it to read-write.

Known exception: `describe_branch` runs `CREATE OR REPLACE FUNCTION public.show_db_tree()` outside a `READ ONLY` transaction, then calls it. The SQL is fixed and the function only reads the system catalogs. This write exists to serve the read and is considered safe. See [AGENTS.md](./AGENTS.md) for details.

## Tool arguments

Every MCP tool argument is `snake_case`, including host tools and generated Management API tools. Published schemas reject unknown keys: camelCase aliases (`projectId`) fail validation. URL grant query params stay camelCase (`?projectId=`, `?category=`, `?readonly=`) because those strings are already in issued OAuth grants and installed MCP URLs.
