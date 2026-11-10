# Changelog

# [NEXT]

Every tool now comes from `@neon/tools` 2.14.2. Tool names, input fields, required fields, and which grants list each tool are unchanged; descriptions are the package's, shorter, with this server's tool names in cross-references. Results that change:

- `search` returns `{ "results": [{ "id", "title", "url" }] }` as `structuredContent` and as JSON text, the OpenAI search shape, instead of an array with a `type` field. It also finds shared projects, compute endpoints, and snapshots.
- `fetch` returns `{ "id", "title", "text", "url", "metadata" }` as `structuredContent` and as JSON text instead of markdown alone; `text` holds the markdown.
- `get_neon_auth_config` returns plain JSON, without the `Neon Auth configuration:` line and code fence.
- `describe_branch` returns one JSON object, `{ "branch", "console_url", "text", "database_structure" }`. When the structure cannot be read, `database_structure` is `null` and `database_structure_error` says why.
- `prepare_query_tuning` returns the `EXPLAIN` rows in `execution_plan` instead of an MCP content object, and includes `role_name` when one was passed.
- `get_connection_string` called without `branch_id` says `Using default branch` instead of naming the branch it resolved.
- A missing table, doc slug that fails validation, missing extension, and a `role_name` the pinned role refuses report `NeonClientError` instead of `NotFoundError` or `InvalidArgumentError`; the message is unchanged.
- Four titles follow the package: `Search Neon resources`, `List organizations for the current user`, `Get connection string`, and `List Neon incidents`.

2025-era Streamable HTTP clients receive an `Mcp-Session-Id` on the `initialize` response and send it on later requests. The server stores nothing under it and never rejects an unknown one; it groups a connection's requests in Sentry, which now also receives the server's logs. Clients that answer a session id with a `GET` stream or a `DELETE` on exit get `405`. 2026-07-28 clients see no change.

`update_auth_logs_export` turns the export of a branch's Neon Auth events to Neon Platform logs on or off, in the `neon_auth` category and hidden in read-only mode. A project without logs export accepts only `enabled: false`. `get_neon_auth_config` reports the current value as `logs_export`, `null` where logs export is not available. Requires `@neon/tools` 2.12.0.

OAuth sign-in completes for clients whose `redirect_uri` is on `127.0.0.1`, such as Codex CLI (`http://127.0.0.1:<port>/callback`). Before, the server stored that redirect as `http://localhost:<port>/callback`, so the browser returned to `localhost` and the client's token request failed with `invalid_request`.

New tool: `list_incidents` returns open Neon incidents, active and upcoming maintenance, and the components and regions neonstatus.com reports as not operational. It needs no Neon credential and is available on every connection, including the anonymous `?category=docs` endpoint, read-only mode, project-scoped grants, and grants with no valid categories. OAuth consent lists it under Discovery. Requires `@neon/tools` 2.11.0.

Authorizing a client that returns through a custom URL scheme, such as older Cursor installs (`cursor://`), ends on a completion page instead of leaving the consent form on screen. The page opens the app, links back to it if the app did not open, and offers a prompt to install the Neon skills. A cancelled or failed authorization opened in a browser gets a page instead of a JSON body. Clients that return to a web or loopback address still get a plain redirect, and non-browser callers see no change. The page reports that it was shown and which of its buttons and links were used, as described under Telemetry in the README.

A refresh token is accepted and revoked only for the OAuth client it was issued to. Before, another client presenting it could receive a cached rotation result, block the owner's next refresh for 10 minutes, or delete it through `/api/revoke`. The owning client's refreshes and replays are unchanged.

OAuth sign-in, token refresh, and API-key requests keep working after the OAuth database drops its connections, for example on a compute restart. Before, one dropped connection could leave every token store on a server instance failing with `Cannot use a pool after calling end on the pool`, and an idle dropped connection raised an uncaught exception.

`run_sql` and `run_sql_transaction` return at most `max_rows` rows per statement (default 100, up to 10,000). When rows were cut, a second content block reports `totalRowCount`, `truncated`, and a note on how to see the rest. A result that fits is unchanged.

A failed SQL tool call returns the Postgres SQLSTATE, error position, and any detail, hint, or context under the error message.

`describe_branch` reads the database structure with one `SELECT` in a `READ ONLY` transaction instead of creating, calling and dropping a `public.show_db_tree()` function. It now works for roles without `CREATE` on `public` and on read-only connections, and it no longer replaces or drops a user's own `public.show_db_tree()`. The tree no longer lists the helper itself; the output format is unchanged. When the structure cannot be read, the result says why, with or without a pinned role.

New `observability` tool: `query_loki_logs` runs a LogQL range query on a branch's Loki-compatible read API and returns Loki's response, with lines grouped by stream labels and nanosecond timestamp strings. It is available in read-only mode. `list_log_fields` and `list_log_field_values` remain the discovery tools for both `query_logs` and `query_loki_logs`. Requires `@neon/tools` 2.10.0.

# [2.0.0] 2026-11-05

MCP transport:

- `serverInfo` on `initialize` and `server/discover` carries `title`, `description`, `websiteUrl`, and `icons` from `server.json`. The same metadata is published as an MCP Server Card at `/mcp/server-card` and `/.well-known/mcp.json`, with an AI Catalog at `/.well-known/ai-catalog.json`.
- Migrate the remote `/mcp` route to stateless MCP 2026-07-28 (SDK v2 + mcp-handler 2.1.0) with a stateless fallback for 2025-era Streamable HTTP clients.
- Retire HTTP+SSE. `GET/POST /sse`, `/message`, `/api/sse`, and `/api/message` return `410 Gone` pointing at Streamable HTTP `/mcp`. The Redis session-binding module is removed with the transport.
- `initialize` and `server/discover` advertise `listChanged: false` for `tools` and `resources`. The tool list is fixed for a connection's grant and the server has no resources, so it never sends a list-changed notification, and 2026-07-28 clients no longer open a `subscriptions/listen` stream waiting for one.
- The refresh-token lock now lives in the OAuth Postgres database (`mcpauth.refresh_locks`, `mcpauth.refresh_transient`, keyed by a SHA-256 of the refresh token). While `KV_URL` is set, `/api/token` also takes the Redis lock first, so deployments that only use Redis keep coordinating during the rollover; a follow-up removes Redis.
- Validate `Origin` on Streamable HTTP requests: a malformed Origin is `403`. Any serialized origin (web pages, browser extensions, desktop webviews) and `null` are accepted on the deployed endpoint, so browser-based clients keep working; a missing Origin is allowed (CLI and server-side clients).

New `projects` tools: `count_projects` returns how many active projects an organization has, resolving `org_id` the way `list_projects` does. `get_project_consumption` and `get_branch_consumption` return consumption metrics (`compute_unit_seconds`, `root_branch_bytes_month`, `public_network_transfer_bytes`, …) per project or per branch for an organization on a Launch, Scale, Agent, Business, or Enterprise plan (per branch excludes Business). All three are available in read-only mode and hidden on project-scoped connections.

Neon Auth branch settings can be changed through MCP: `update_auth_allow_localhost`, `update_auth_email_and_password`, `update_auth_email_provider`, `send_auth_test_email`, `update_auth_plugins_organization`, `update_auth_plugins_magic_link`, `update_auth_plugins_phone_number`, and `update_auth_webhooks`, in the `neon_auth` category and hidden in read-only mode. `get_neon_auth_config` also returns `plugins` (organization, magic link, phone number) and `webhook`; a failed read of either is reported under `_errors` without failing the tool. Requires `@neon/tools` 2.8.0.

`get_neon_auth_config` reports `revoke_sessions_on_password_reset` under `auth_methods.email_password`: whether resetting a user's password revokes all of their sessions.

`create_postgres_role` takes `access`: `read_only` or `read_write` creates a role scoped to `database_name` (optional when the branch has one database) and `schemas` (default `["public"]`), and returns its password like an admin role. Without `access` the role still joins `neon_superuser`, and the description now says so. A connection pinned with `?roleName=` refuses scoped `access`, because the role is created with SQL as the database owner. Requires `@neon/tools` 2.6.0.

A tool argument of `.` or `..` that goes into a Management API path, such as `database_name: ".."` on `delete_postgres_database`, is now a tool error (`Path parameter database_name cannot be "..".`) and no request is sent. URL parsing resolved it as a dot segment, so the request could reach a different route. Requires `@neon/sdk` 7.8.2 and `@neon/tools` 2.6.2.

`search` works for a personal account (every OAuth sign-in and personal API key) that belongs to more than one organization; it failed with `Multiple organizations found. Please specify the org_id parameter`, a parameter `search` does not take. With one organization, each matching project and branch is listed once instead of twice.

The OAuth consent screen says where the sign-in returns for this request ("Returns to cursor.com", the full URI for an app scheme such as `cursor://`) and, for a loopback redirect, that it returns to an app on this computer. A client that signs in with a Client ID Metadata Document shows "App identity published at <host>" under its name.

Realtime, Neon Functions, function trigger, Object Storage, and AI Gateway tools called on a project outside the regions that run those features now say which region the project is in and which regions support the feature, followed by the API's original message: `Realtime is not available for this project: it is in aws-us-west-2. Realtime runs in aws-us-east-2, aws-us-east-1, aws-eu-central-1, and aws-ap-southeast-1. Create a project in one of those regions to use it. (API error: "Realtime is not available for this project")`. Requires `@neon/tools` 2.5.2.

A Client ID Metadata Document `client_id` whose host name does not resolve or whose TLS certificate does not verify is refused with `400 invalid_client` instead of `503 temporarily_unavailable`; timeouts and other connection failures still answer 503.

OAuth authorization responses carry `iss` (RFC 9207) on every redirect back to the client: the code, an upstream error, and a cancelled consent. Authorization server metadata advertises `authorization_response_iss_parameter_supported: true`.

OAuth clients can identify themselves with a Client ID Metadata Document: an `https://` URL as `client_id` that serves the client's metadata, used by Claude, ChatGPT, VS Code and others when a server advertises `client_id_metadata_document_supported: true`. No `/api/register` call is needed. A document that declares `token_endpoint_auth_method: private_key_jwt` (ChatGPT's does) authenticates at the token and revocation endpoints with a signed client assertion (RFC 7523) checked against its `jwks_uri`; the server now advertises `private_key_jwt`. Dynamic client registration and every registered client keep working. The token endpoint accepts the loopback `redirect_uri` an authorization code was issued for, so clients that register a portless loopback callback can exchange codes issued on a random port.

`add_auth_oauth_provider` and `update_auth_oauth_provider` accept the `apple` provider with `apple_team_id` and `apple_key_id`; `delete_auth_oauth_provider` accepts `apple` too. Requires `@neon/tools` 2.5.1.

The `list_auth_oauth_providers`, `add_auth_oauth_provider`, `update_auth_oauth_provider` and `delete_auth_oauth_provider` descriptions name Apple among the social login providers and say that Microsoft and Apple have no shared app, so they need your own credentials. The `add_auth_oauth_provider` description lists the Apple fields (`client_id` as the Services ID, `client_secret` as the `.p8` key, `apple_team_id`, `apple_key_id`), and `update_auth_oauth_provider` says a new Apple `client_secret` must be sent with its `apple_key_id`. `get_neon_auth_config` shows `microsoft_tenant_id`, `apple_team_id` and `apple_key_id` on each OAuth provider that has them; `client_secret` stays redacted.

Neon Auth OAuth server tools under `?category=neon_auth`: `get_auth_oauth_server` and `update_auth_oauth_server` configure Neon Auth as an OAuth 2.1 authorization server (including for MCP servers), and `list_auth_oauth_clients`, `get_auth_oauth_client`, `create_auth_oauth_client`, `update_auth_oauth_client`, `delete_auth_oauth_client` and `rotate_auth_oauth_client_secret` manage its OAuth clients. `get_auth_oauth_server`, `list_auth_oauth_clients` and `get_auth_oauth_client` are available in read-only mode. `create_auth_oauth_client` and `rotate_auth_oauth_client_secret` return the `client_secret` once; every other tool still omits it. Requires `@neon/tools` 2.5.0. A token already issued with an explicit category list that includes `neon_auth` gains these tools.

The `list_auth_oauth_providers`, `add_auth_oauth_provider`, `update_auth_oauth_provider` and `delete_auth_oauth_provider` descriptions now say they manage social login providers, not the Neon Auth OAuth server tools; the OAuth server and client tool descriptions name the OAuth server consistently.

`search_docs` and `get_doc` replace `list_docs_resources` and `get_doc_resource`. `search_docs` searches neon.com (docs, API reference, PostgreSQL tutorial, guides, FAQs, changelog, and blog) with the search behind the neon.com search box and returns ranked pages, each with a `slug`. It takes `query`, optional `categories`, and optional `limit` (1-40, default 10). `get_doc` takes that `slug` and returns the page as markdown. Both are in the `docs` category, available in read-only mode, under project-scoped grants, and on the no-login `?category=docs` endpoint. Calls to `list_docs_resources` or `get_doc_resource` now fail as unknown tools. `NEON_SITE_SEARCH_URL` and `NEON_DOCS_BASE_URL` override the endpoints; `NEON_DOCS_INDEX_URL` is gone.

Branch Realtime tools under `?category=realtime`: `get_realtime`, `enable_realtime`, `disable_realtime`, `get_realtime_secret`, and `rotate_realtime_secret`. `get_realtime_secret` is unavailable in read-only mode. Requires `@neon/tools` 2.2.0. A token already issued with an explicit category list does not include `realtime`; tokens issued for every category do.

`describe_branch` drops its `public.show_db_tree()` helper function in the same transaction that reads the tree, so the function no longer stays in the described database. The tool output is unchanged.

`run_sql_transaction` is no longer available in read-only mode, because a `COMMIT` or `SET TRANSACTION READ WRITE` statement in the batch could end the read-only transaction. Read-only connections use `run_sql`, one statement per call.

`send_feedback` sends anonymous feedback to the Neon feedback service (`source: "neon_mcp"`). It sends only the feedback text. It is available under every grant, in read-only mode, and on the no-login `?category=docs` endpoint. `NEON_FEEDBACK_URL` overrides the endpoint.

`?roleName=` makes every SQL tool log in as that Postgres role instead of the database owner, so the role's grants decide what an agent can read and change. With OAuth, set it on the MCP URL (a fixed grant on the authorization page) or in the optional **Postgres role** field on the default authorization page; `get_connection_string` is withheld on a pinned connection, and a role that cannot log in fails the call without falling back to the owner.

`run_sql` and `run_sql_transaction` accept optional `role_name` and `compute_id`. On a pinned connection, `role_name` must match the pin.

Generated tool calls classify Neon API 4xx responses by their `kind` and HTTP status even when `@neon/tools` and the server load different `@neon/sdk` versions, returning the API error to the MCP client without reporting it as a server failure.

OAuth dynamic client registration normalizes scalar and mixed `redirect_uris` values to a string array before storage. Authorization applies the same normalization to existing client records without changing which redirect URI schemes are accepted.

Scheduled function triggers (`list_triggers`, `get_trigger`, `create_trigger`, `update_trigger`, `delete_trigger`) under `?category=functions`, and branch credentials (`list_credentials`, `create_credential`, `revoke_credential`, `rotate_credential`) under `?category=branches`. Requires `@neon/tools` 1.3.0. `credentials.reveal` is not a tool.

`clientApplication` on analytics events now classifies Devin, Perplexity, Hermes Agent, and Grok connector sessions. `grok-cli` stays `grok-build`.

When the MCP handshake or User-Agent does not name a product (`node`, `undici`), `clientApplication` on analytics events falls back to the OAuth client's registered name.

List, register, and delete branch custom domains: `list_functions_custom_domains`, `register_functions_custom_domain`, `delete_functions_custom_domain` (`?category=functions`). Requires `@neon/tools` 1.2.0.

Management API tools now come from `@neon/tools` 1.0.0. Hosts select SDK method paths (`projects.list`); the package default is already verb-first (`list_projects`). This server still overrides historical and singular names (`describe_project`, `create_project`, `create_branch`, `reset_from_parent`, `compare_database_schema`, `provision_neon_auth`, `provision_neon_data_api`, `list_branch_computes`). `create_project` and `create_branch` call `projects.create` / `branches.create` (compute on by default, no connection string). Operation-backed writes wait. Raw Management API operations, `operations.waitFor`, `createAndConnect` tools, JWKS, VPC, anonymization, masking, org-member reads, and project member/permission writes are not tools. Host tools stay for SQL, inspect, migrations, query tuning, docs, search, `list_organizations`, `get_connection_string`, and redacted `get_neon_auth_config`. Every tool argument is `snake_case` (`project_id`, `database_name`, `sql_statements`), including host tools. Unknown camelCase aliases fail schema validation. Project-aware tools publish the same optional `project_id` field across grants, with instructions suitable for hosts that cache schemas. Unscoped calls still require an explicit ID at full handler validation. Scoped calls inject an omitted ID from the grant, accept a matching explicit ID, and reject a conflicting ID before invoking the handler. URL grant query params stay camelCase (`?projectId=`, `?category=`, `?readonly=`). New `?category=` values: `functions`, `storage`, `endpoints`, `snapshots`. `?category=branches` includes role and database tools and no longer includes compute-endpoint tools (`?category=endpoints`). A token already issued for `branches` gains those role and database writes. Unknown `?category=` values are ignored and named on initialize notices. `limit` on a list tool caps how many items come back.

A GET snapshot of a standard email provider reports `password` as `***redacted***` when the API returns an empty string.

`inspect_database`: omitting `database_name` now covers every database on the branch (same contract as `neon inspect db` 3.4.0). Database-scoped checks add a `database` column; compute-wide checks run once against the first listed database. One failing database fails the whole run.

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

- Issue `*` on OAuth tokens when the client requested it and write was granted. `scopes_supported` is `read` and `write`; `*` remains an alias, not an advertised scope. Callback uses the per-flow authorize state for token scope instead of the client-keyed KV row.
- Stop embedding MCP-specific grant context (scope categories, read-only mode, project-id scoping) in the upstream OAuth `state` parameter; the Neon console OAuth backend doesn't understand those scopes and shouldn't see them. Grant context is now resolved from the saved client registration, OAuth resource URI, or MCP URL query params.
- MCP-specific configuration moved from custom `X-Neon-*` headers to URL query parameters where appropriate, simplifying client wiring (the legacy `x-read-only` header still works).
- Pass tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) through `registerTool` to the MCP response — they were defined but not actually surfaced to clients.

Observability:

- Emit a structured `[SLO] refresh outcome=<bucket> elapsedMs=<n> clientId=<id> ...` log line at every refresh-grant exit point. Buckets: `success`, `correct_invalid_grant`, `cliff_upstream`, `transient_lock_timeout`, `transient_persist_failure`, `transient_upstream_5xx`, `transient_upstream_network`, `bad_request`. The new `transient_upstream_network` bucket separates network-layer failures from HTTP 5xx so the diagnostic vector is preserved even though both are excluded from the SLO denominator.

Tool authorization:

- `get_connection_string` now requires write access. The connection string carries a privileged role password, so a read-only caller could use it to connect directly and write. Read-only tool count drops from 23 to 22, and the read-only notice now points users at the Neon Console for a `DATABASE_URL`.
- Remove the read-replica selection this tool applied in read-only mode. It rewrote the URI's hostname while leaving the credentials untouched, so it never restricted what the string could be used for. Internal callers such as `run_sql` and `inspect_database` are unaffected.

Transport security:

- Bind SSE sessions to the caller identity that opened them. Previously any caller who knew or guessed a live `sessionId` could `POST /api/message` and inject responses into the victim's SSE stream; the binding key is hashed and stored in Redis alongside the existing session record.
- Bind the SSE session-identity to the OAuth `client_id` instead of the bearer token. Hourly token refreshes (handled cleanly by the refresh-chain fixes above) used to rotate the bearer and so flip the identity hash, which caused the next `POST /api/message` to return a `403 session_not_owned` — Cursor's MCP client interpreted that as an auth failure and prompted the user to re-authenticate. `client_id` is stable across token rotations for a given registered MCP client, so the binding now survives refreshes; cross-account and cross-OAuth-client POSTs still mismatch as before.
- Relay upstream OAuth error redirects from `/callback` to the originating MCP client per RFC 6749 §4.1.2.1. Previously when upstream Hydra redirected to `/callback?error=…&state=…` (no `code`), the route returned a generic `400 {"error":"invalid_request","error_description":"Missing code or state"}` and the user was stranded on a Neon page. Now the `error`, `error_description`, `error_uri` and the client's original `state` are forwarded to the registered `redirect_uri` so Cursor / ChatGPT / Claude can present a meaningful retry UI on their own side. The well-known Hydra fingerprint `error=error&error_description=The error is unrecognizable` is preserved and tracked separately as `upstream_unmapped_error` in the auth-callback SLO so it's visible in dashboards instead of being conflated with user-driven cancels.
- Add an auth-flow SLO at `/callback` — `[SLO] auth-callback outcome=<bucket> elapsedMs=<n> ...` emitted at every exit point, mirroring the refresh SLO at `/api/token`. Buckets: `success`, `correct_user_denied`, `upstream_unmapped_error`, `upstream_5xx`, `upstream_other_error`, `state_decode_failed`, `bad_request`, `internal_error`. See `ai-notes/auth-callback-slo.md` for the definition and targets.
- Fix `lib/errors.ts` constant typo that silently suppressed structured upstream-error handling. The handler compared against `'RESPONSE_BODY_ERROR'` while oauth4webapi's actual constant is `'OAUTH_RESPONSE_BODY_ERROR'`, so every conforming OAuth error body from upstream (status 400 + JSON `{error, error_description}`) fell through to the generic `500 server_error` path instead of being relayed as a `400` with the upstream message. Also adds handling for `OAUTH_RESPONSE_IS_NOT_CONFORM` (upstream returned an unexpected HTTP status — e.g. Hydra 500 with non-JSON body): now returns `502 upstream_error` with the upstream status included in the description, instead of a generic `500`.

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
