# Explicit OAuth grant revocation

Layer: this MCP server's OAuth storage, token/revoke handlers and issuer integration. The follow-up was identified in #430. Client binding from #435 and replay policy from #449 remain in force; replay alone does not revoke a grant.

## Denial and issuer retirement

An authenticated explicit revoke traces the reachable owned lineage, commits canonical denial, known AT/RT digest aliases and the captured issuer pair in `mcpauth.grant_revocations`, then resolves the current pair again before cleanup. Normal token validation, cached responses and refresh writes consult denial. Physical rows may remain, but a known denied family cannot authorize or produce a successful refresh response after its marker is observed. The final check is not atomic with HTTP delivery.

Both credentials of each known issuer pair are submitted to the configured RFC 7009 endpoint using the broker client. Pending entries are keyed by both AT and RT; acknowledging both requests removes only that pair key. Concurrent entries survive snapshot draining. A later authenticated revoke finds pending work through digest aliases after source cleanup. Late issuer responses queue their pair for compensation. Incomplete retirement returns retryable failure without credentials; no background drainer is installed.

## Existing grants

Existing rows without family metadata remain usable. On first validation or refresh, the server traces the available owned lineage, checks its canonical identity and every reachable alias for denial, and saves the access record's family identity under before/after denial guards. Cached recovery also checks that its captured root has not changed. Storage errors, known denial, owner/family conflicts or a changed root do not become authorization success. New rotations carry family metadata through the cache and both token stores.

This compatibility choice has a specific limit: a wholly unbound legacy chain whose intermediate links were already lost can look identical to an unrelated active grant. An old RT0 cache may still reach retained AT1/RT1 while its link to a later revoked RT3 has disappeared. Neither the RT3 marker nor its aliases are then reachable from RT0, so lazy binding cannot establish that they were one grant. The tests retain this counterexample. Whole-family denial covers bound families and known reachable legacy lineage, not every disconnected historical legacy credential. Verified migration/backfill is needed for a stronger historical guarantee; this patch does not force all existing users to sign in again.

## Rollout, storage and cost

Provision the table and its CREATE/SELECT/INSERT/UPDATE/DELETE rights, or create it before deployment. Update every serving reader/writer before claiming enforcement; old binaries ignore markers. Keep denial keys without an automatic TTL until credential lifetimes, writers, caches, backups and rollback have a coordinated retention policy.

Pending entries contain raw issuer credentials until both requests are acknowledged. Apply token-store access and backup controls. Per-pair issuer calls, including discovery, have a 4.5-second deadline and share an eight-second phase signal. SQL uses the existing connection/retry policy, so this is not an end-to-end eight-second request bound. A database outage preventing intent persistence cannot establish durable compensation; combined database/issuer failure requires operational recovery.

Warm active bearer validation adds one denial SELECT. Caching an active/not-revoked result in process would allow a revoked grant until cache expiry and weaken immediate denial. A deny-only cache could absorb repeated rejected traffic but would not remove the active-token lookup; none is added. No production load or latency benchmark is claimed.

## Verification boundary

Native tests use a real local OAuth PostgreSQL database and synthetic issuer. Separate protocol tests run real openid-client discovery/revocation through a fixture-only adapter mapping one synthetic HTTPS origin to its loopback HTTP server. They verify requests and cancellation, not TLS or deployed issuer behavior, and require no checked-in private key or production insecure-HTTP exception. Actual provider endpoint support, historical-token cascading, native clients, hosted Neon, mixed-version rollout and production durability remain deployment-owner checks.
