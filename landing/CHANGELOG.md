# Changelog

# [Unreleased]

- Feat: OAuth scope selection UI - users can now opt out of write access during authorization
- Fix: Read-only mode now correctly respects OAuth scopes (only `read` scope enables read-only mode)
- Fix: Handle project-scoped API keys gracefully when account-level endpoints are inaccessible
- Fix: Token endpoint now returns proper response
- Chore: Improved logging across OAuth and transport code paths

# [0.7.0] 2025-12-29

- Feat: Add Neon Auth v2 support with Better Auth provider and branch-level provisioning
- Feat: Add `setup-neon-auth` prompt with client-specific instructions for Vite+React projects
- Feat: Add `load_resource` tool to expose guides (like `neon-get-started`) via MCP tools
- Feat: Add read-only mode for enhanced safety in production environments via `X-READ-ONLY` header
- Feat: Add `server_init` analytics event with improved client detection for HTTP transports
- Feat: `compare_database_schema` tool to generate schema diff for a specific branch with prompt to generate migration script
- Feat: `neon-get-started` resource to add AI rules with steps and instructions to integrate projects with Neon
- Feat: Add generic `search` and `fetch` tools for organizations, projects, and branches
- Docs: Add neon init reference and improve README documentation

# [0.6.5] 2025-09-16

- Feat: `list_shared_projects` tool to fetch projects that user has permissions to collaborate on
- Feat: `reset_from_parent` tool to reset a branch from its parent's current state
- Feat: `compare_database_schema` tool to compare the schema from the child branch and its parent
- docs: add copyable server link on langing page

# [0.6.4] 2025-08-22

- Fix: Do not log user sensitive information on errors
- Fix: Return non-500 errors as valid response with `isError=true` without logging
- Improvement: Custom error handling user generated erorrs
- Improvement: Extend org-only users search to support orgs not managed by console.

# [0.6.3] 2025-08-04

- Feat: A new tool to list authenitcated user's organizations - `list_organizations`
- Docs: Switch configs to use streamable HTTP by default
- Impr: While searching for project in `list_projects` tool, extend the search to all organizations.

## [0.6.2] 2025-07-17

- Add warnings on security risks involved in MCP tools in production environments
- Migrate the deployment to Koyeb
- Mark `param` as required argument for all tools

## [0.6.1] 2025-06-19

- Documentation: Updated README with new tools and features
- Support API key authentication for remote server

## [0.6.0] 2025-06-16

- Fix: Issue with ORG API keys in local mode
- Refc: Tools into smaller manageable modules
- Feat: New landing page with details of supported tools
- Feat: Streamable HTTP support

## [0.5.0] 2025-05-28

- Tracking tool calls and errors with Segment
- Capture exections with Sentry
- Add tracing with sentry
- Support new org-only accounts

## [0.4.1] - 2025-05-08

- fix the `npx start` command to start server in stdio transport mode
- fix issue with unexpected tokens in stdio transport mode

## [0.4.0] - 2025-05-08

- Feature: Support for remote MCP with OAuth flow.
- Remove `__node_version` tool
- Feature: Add `list_slow_queries` tool for monitoring database performance
- Add `list_branch_computes` tool to list compute endpoints for a project or specific branch

## [0.3.7] - 2025-04-23

- Fixes Neon Auth instructions to install latest version of the SDK

## [0.3.6] - 2025-04-20

- Bumps the Neon serverless driver to 1.0.0

## [0.3.5] - 2025-04-19

- Fix default database name or role name assumptions.
- Adds better error message for project creations.

## [0.3.4] - 2025-03-26

- Add `neon-auth`, `neon-serverless`, and `neon-drizzle` resources
- Fix initialization on Windows by implementing correct platform-specific paths for Claude configuration

## [0.3.3] - 2025-03-19

- Fix the API Host

## [0.3.2] - 2025-03-19

- Add User-Agent to api calls from mcp server

## [0.3.1] - 2025-03-19

- Add User-Agent to api calls from mcp server

## [0.3.0] - 2025-03-14

- Add `provision_neon_auth` tool

## [0.2.3] - 2025-03-06

- Adds `get_connection_string` tool
- Hints the LLM to call the `create_project` tool to create new databases

## [0.2.2] - 2025-02-26

- Fixed a bug in the `list_projects` tool when passing no params
- Added a `params` property to all the tools input schemas

## [0.2.1] - 2025-02-25

- Fixes a bug in the `list_projects` tool
- Update the `@modelcontextprotocol/sdk` to the latest version
- Use `zod` to validate tool input schemas

## [0.2.0] - 2025-02-24

- Add [Smithery](https://smithery.ai/server/neon) deployment config

## [0.1.9] - 2025-01-06

- Setups tests to the `prepare_database_migration` tool
- Updates the `prepare_database_migration` tool to be more deterministic
- Removes logging from the MCP server, following the [docs](https://modelcontextprotocol.io/docs/tools/debugging#implementing-logging)

## [0.1.8] - 2024-12-25

- Added `beforePublish` script so make sure the changelog is updated before publishing
- Makes the descriptions/prompts for the prepare_database_migration and complete_database_migration tools much better

## [0.1.7-beta.1] - 2024-12-19

- Added support for `prepare_database_migration` and `complete_database_migration` tools
