# Contributing

Development commands, architecture, and how to add tools are in [AGENTS.md](./AGENTS.md).

## Tool arguments

Every MCP tool argument is `snake_case`, including host tools and generated Management API tools. Published schemas reject unknown keys: camelCase aliases (`projectId`) fail validation. URL grant query params stay camelCase (`?projectId=`, `?category=`, `?readonly=`) because those strings are already in issued OAuth grants and installed MCP URLs.
