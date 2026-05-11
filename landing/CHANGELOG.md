# Changelog

# [NEXT]

OAuth refresh-token chain stability — drove the reconstructed refresh-grant SLO from ~93% to 100% in production by closing the cross-instance reuse race and the surrounding cliff/retry-storm paths.

Refresh-token reliability:

- Singleflight intra-instance dedup: when N concurrent requests arrive on the same Vercel container with the same refresh token, only one forwards to Hydra and the others wait for the shared result, instead of all racing upstream.
- Add a Redis-backed distributed lock around refresh-token rotation so two serverless instances handling the same refresh token no longer both forward to Hydra, which would detect token reuse and revoke the entire chain.
- Extend the cross-instance success cache to 7 days and write it before persisting the rotated tokens; subsequent retries that arrive while persistence is in flight (or after persistence has failed) replay the cached result instead of presenting an already-rotated token upstream.
- Cache upstream 4xx responses for 10 minutes and capture structured upstream-error details, so retry storms from a single client short-circuit at our layer instead of forwarding hundreds of redundant calls to Hydra.
- Cache pre-upstream failure paths (refresh token not found, access token not found, client mismatch) so concurrent waiters resolve to a clean `400 invalid_grant` instead of timing out the lock with a `503`.
- Retry the rotated-token persist phase and degrade to the success cache when the KV write keeps failing, so clients always pick up the new pair instead of presenting a now-dead refresh token.
- Retry the upstream `/oauth2/token` exchange on network-layer failures (`ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `ECONNREFUSED`, `EAI_AGAIN`, `EPIPE`, `EHOSTUNREACH`, `ENETUNREACH`, `UND_ERR_SOCKET`); HTTP 4xx/5xx are intentionally not retried because Hydra may have already rotated.
- Reject upstream responses missing `refresh_token` with `502` and apply a logged 1-hour floor when `expires_in` is missing, instead of minting already-expired tokens.
- Close a lock-waiter micro-race where a holder finishing between the waiter's two polls left the waiter blind to the just-written cache, causing spurious `503`s.
- Release the refresh lock and the transient-failure marker in a single atomic Lua eval. Previously the two were separate Redis SETs; on Upstash HA Redis a waiter's reads could land on different replicas and see the lock-release before the marker, falling through to a 5-second `transient_lock_timeout` instead of bailing fast as `transient_upstream_5xx`. The 2026-05-08 07:17 UTC Hydra burst exposed this with 12/12 cascaded lock-timeouts; the atomic release removes the replication window.
- Cap each upstream `/oauth2/token` attempt at 4.5 seconds. Production data shows Hydra 5xx is bimodal — fast (<200ms) or slow (4.5–37s, holding the connection open). Without a cap, slow responses caused the lock holder to outlive the waiter's poll budget; the waiter timed out as `transient_lock_timeout` (counts BAD) instead of bailing as `transient_upstream_5xx` (excluded). The cap is non-retryable (server-side outcome unknown) and routes through the same atomic Lua release-with-marker path so concurrent waiters bail fast.
- Bump the lock-waiter poll budget from ~5s to ~8s (`LOCK_POLL_MAX_ATTEMPTS` 50 → 80). Sized to absorb the 4.5s upstream cap plus the holder's release + transient-marker write plus a ~3s margin for poll granularity and Redis RTT, so the holder's release always lands before the waiter gives up.
- Make refresh locks resilient to vanished holders. The lock TTL is now short (6s, refreshed by a heartbeat while the holder is alive) so a Vercel function killed mid-flight by the platform (OOM, container shutdown, host eviction) doesn't keep waiters blocked for the previous 30 seconds. When a waiter sees the lock disappear without a cached result, it performs a single takeover attempt: `SET NX` onto the freed key and run `executeRefresh` itself. The takeover cap (one attempt) keeps upstream calls bounded at N+1 where N = number of vanished holders; concurrent waiters race the takeover via `SET NX` so `executeRefresh` still runs at most once per token. The 2026-05-08 07:17 UTC burst (12 cascaded `transient_lock_timeout` events with no accompanying upstream 5xx) was the canonical case for this pattern.
- Forward the upstream OAuth error code (e.g. `token_inactive`, `invalid_client`, `invalid_request`, `invalid_grant`) into the `[SLO] refresh outcome=cliff_upstream …` log line as `upstreamOauthError=<code>`. Lets cliff bursts be classified by upstream cause via a single grep pipeline instead of cross-correlating with the sibling `Upstream refresh token exchange failed` lines.
- Stop deleting the stored refresh token when the upstream rotation returned the same token value (no-op rotations no longer poison the KV between cache write and persist).
- Reinitialize the OAuth Keyv (Postgres) store when connection errors indicate a poisoned pool, so credential rotation or terminated connections no longer break every request until the serverless container recycles.

Auth correctness:

- Stop embedding MCP-specific grant context (scope categories, read-only mode, project-id scoping) in the upstream OAuth `state` parameter; the Neon console OAuth backend doesn't understand those scopes and shouldn't see them. Grant context is now resolved from the saved client registration, OAuth resource URI, or MCP URL query params.
- MCP-specific configuration moved from custom `X-Neon-*` headers to URL query parameters where appropriate, simplifying client wiring (the legacy `x-read-only` header still works).
- Pass tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) through `registerTool` to the MCP response — they were defined but not actually surfaced to clients.

Observability:

- Emit a structured `[SLO] refresh outcome=<bucket> elapsedMs=<n> clientId=<id> ...` log line at every refresh-grant exit point. Buckets: `success`, `correct_invalid_grant`, `cliff_upstream`, `transient_lock_timeout`, `transient_persist_failure`, `transient_upstream_5xx`, `transient_upstream_network`, `bad_request`. The new `transient_upstream_network` bucket separates network-layer failures from HTTP 5xx so the diagnostic vector is preserved even though both are excluded from the SLO denominator.

Transport security:

- Bind SSE sessions to the caller identity that opened them. Previously any caller who knew or guessed a live `sessionId` could `POST /api/message` and inject responses into the victim's SSE stream; the binding key is hashed and stored in Redis alongside the existing session record.
- Bind the SSE session-identity to the OAuth `client_id` instead of the bearer token. Hourly token refreshes (handled cleanly by the refresh-chain fixes above) used to rotate the bearer and so flip the identity hash, which caused the next `POST /api/message` to return a `403 session_not_owned` — Cursor's MCP client interpreted that as an auth failure and prompted the user to re-authenticate. `client_id` is stable across token rotations for a given registered MCP client, so the binding now survives refreshes; cross-account and cross-OAuth-client POSTs still mismatch as before.

Other:

- Serve the OpenAI Apps Challenge verification token at `/.well-known/openai-apps-challenge`.
- Migrate the package manager from Bun to pnpm (pinned via Corepack); see `landing/CLAUDE.md` for development setup.
- Add a one-click "Add to Kiro" install badge to the README.

# [1.0.0]

- Existing clients remain compatible, with new options to scope access by project and capability categories.
- Added support for grant-aware tool filtering via `X-Neon-*` headers, including read-only mode controls.
- Added `/api/list-tools` so clients can preview exactly which tools are available for a given scope/read-only configuration.
- OAuth authorization now preserves and applies client registration context, including read-only defaults, for more predictable permissions UX.
- OAuth metadata now advertises supported grant scope categories for better client discovery.
- Added an anonymous, no-OAuth docs endpoint: `mcp.neon.tech/mcp?category=docs` exposes only the `list_docs_resources` and `get_doc_resource` tools and bypasses OAuth entirely. Triggers strictly when `category=docs` is the only scope and no `projectId` is set; any other combination still requires authentication.

# [0.8.0]

- Feat: Add `list_docs_resources` and `get_doc_resource` tools for browsing and fetching Neon documentation pages
- Remove `load_resource` tool in favor of `list_docs_resources` and `get_doc_resource`
- Feat: Add `scope` metadata to all tool definitions for grant category filtering (`projects`, `branches`, `schema`, `querying`, `performance`, `neon_auth`, `data_api`, `docs`)
- Improvement: Refine scope mapping by assigning `compare_database_schema` to `schema` and `provision_neon_data_api` to dedicated `data_api` scope
- Feat: Add `provision_neon_data_api` tool for HTTP-based database access with JWT authentication
- Feat: Add traceId for request correlation across logs, analytics, and error reports
- Feat: Add MCP tool annotations (title, readOnlyHint, destructiveHint, idempotentHint, openWorldHint)
- Feat: OAuth scope selection UI - users can now opt out of write access during authorization
- Fix: Read-only mode now correctly respects OAuth scopes (only `read` scope enables read-only mode)
- Fix: Handle project-scoped API keys gracefully when account-level endpoints are inaccessible
- Fix: Make `provision_neon_auth` tool idempotent - returns existing integration details if already provisioned
- Fix: Token endpoint now returns proper response
- Fix: RFC 8252 loopback redirect URI matching - localhost, 127.0.0.1, and ::1 are now treated as equivalent
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
