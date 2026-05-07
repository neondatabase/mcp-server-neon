# Refresh-token endpoint SLO

## Why

PRs #229 / #231 / #232 / #233 / #234 closed the largest sources of OAuth refresh-token chain revocation. We need a measurable SLO so we can:

1. Detect regressions — any of those 5 PRs could be reverted by mistake or eroded by future changes; an SLO surfaces it.
2. Quantify residual cliffs — current data suggests ~4/hour of upstream `token_inactive` events still fire (presumed: persist failure between upstream success and local KV write). The SLO gives us a target to drive that to 0.
3. Own the cliff problem end-to-end — without a number, "is it good now?" stays a vibe.

## SLO definition

**Refresh chain integrity**: the fraction of `/api/token` `grant_type=refresh_token` requests where neither **(a)** upstream Hydra reports the token chain dead nor **(b)** our server fails to produce a definitive answer.

```
SLO = 1 - (bad_outcomes / classified_outcomes)
target: 99.9%  (i.e., bad_outcomes < 0.1% per attempt)
window: rolling 28 days
```

Where:

| Outcome bucket | Counts in denominator? | Counts as bad? | Notes |
|---|---|---|---|
| `success_fresh` | yes | no | upstream rotated successfully |
| `success_cache_replay` | yes | no | cross-instance success cache hit (avoids upstream call) |
| `correct_invalid_grant` | yes | no | client presented a token we knew was dead (RT-not-found, failure-cache hit, etc.). Client gets a clean 400 and re-auths; our system did the right thing. |
| `cliff_upstream` | yes | **yes** | upstream returned `token_inactive` / `invalid_request` / similar 4xx. Hydra has revoked the chain; user must re-auth. **This is the cliff we've been fighting.** |
| `transient_lock_timeout` | yes | **yes** | our lock-waiter polled out and returned 503. After PR #234 this should be 0; if non-zero, we have a regression. |
| `transient_persist_failure` | yes | **yes** | upstream rotation succeeded but our KV write threw, so the client can't pick up the new pair and will retry the now-dead RT. Currently inferred from `token_inactive` events on RTs we've never written failures for; will become directly observable once instrumented. |
| `transient_upstream_5xx` | **no** | n/a | Hydra returned an HTTP 5xx response. Out of our control; excluded. |
| `transient_upstream_network` | **no** | n/a | Network-layer failure reaching Hydra (`ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `ECONNREFUSED`, etc., anywhere in the error-cause chain). The route wraps the upstream call in a 2-attempt retry on this category before classifying, so this bucket only counts errors that survived retry. Tracked separately from `transient_upstream_5xx` because the diagnostic vector differs — network volume points at TCP/DNS/peering health, 5xx volume points at Hydra-application health. Excluded from SLO. |
| `bad_request` | **no** | n/a | malformed request (missing `refresh_token`, wrong content-type, etc.). Client error; excluded. |

### Why this shape

- **Excluding `correct_invalid_grant` from "bad"** is essential. A user re-auths every time a refresh token is genuinely stale (e.g., they didn't open Cursor for >30 days, or their account was administratively de-authed). Counting those as SLO failures would set an unattainable ceiling and bury the actual regressions in noise.
- **Including `transient_lock_timeout` and `transient_persist_failure` as bad** is intentional. They're the failure modes we own and can reduce.
- **Excluding `transient_upstream_5xx`** matches industry practice — provider-side outages don't count against the application SLO.

## Current best-known state (pre-instrumentation, derived from grep)

Sample window 2026-05-06T11:09Z–12:29Z (~75 min, post #234 deploy):

```
cliff_upstream:           5  (all 5 distinct clients, 1 cliff each)
transient_lock_timeout:   0  ✓
correct_invalid_grant:   ~125  (RT-not-found 66 + failure-cache 104, deduped for retries)
success_*:               unknown (CLI capping noise)
```

Without `success_*` totals we can't compute the SLO yet. The structured metric emission below fixes that.

## Implementation

### 1. Metric line format

A single structured `info`-level log line emitted at every exit of the refresh-grant handler:

```
[SLO] refresh outcome=<bucket> elapsedMs=<n> clientId=<id> ...
```

Stable prefix `[SLO] refresh ` makes it cheap to filter via `vercel logs --query`. The other fields are JSON-style key=value tokens that are easy to parse but readable to humans.

Buckets emitted: `success_fresh | success_cache_replay | correct_invalid_grant | cliff_upstream | transient_lock_timeout | transient_persist_failure | transient_upstream_5xx | bad_request`.

### 2. Computation script

`~/.neon-mcp-24h-debug/refresh-slo-compute.sh` queries Vercel logs over a configurable window, classifies each `[SLO] refresh` line by `outcome=`, and prints:

- counts per bucket
- numerator / denominator / SLO percentage
- error budget consumed for the window
- top failing clients in each "bad" bucket

### 3. Alerting (later)

Once the metric stabilises we can add a Vercel log drain → metrics platform (Datadog, Honeycomb, Grafana Cloud) and alert when `bad / classified > 0.5%` over 1 hour (10× the SLO target — tightening over time as we validate the floor).

## Future tightening

After we eliminate the residual `cliff_upstream` events (likely by hardening the persist phase post-upstream), we can ratchet the target to **99.99%** (≤0.01% bad). At ~50k refreshes/day that's ≤5 bad events/day — comfortable headroom, and any spike alerts immediately.
