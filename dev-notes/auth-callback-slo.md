# /callback (OAuth code-grant) SLO

Companion to `dev-notes/refresh-slo.md`. Tracks the **initial authorization** flow: every time an MCP client (Cursor, Claude, ChatGPT, etc.) sends a user through `/api/authorize` → upstream Hydra → back to our `/callback` → handed off to the client's redirect URI.

## Why

Before this metric existed, the entire callback path was a black hole. Failures showed up as cryptic JSON 400s on the user's browser (`Missing code or state`) with no log lines distinguishing:
- the user clicked Cancel at Hydra (system worked correctly),
- Hydra returned an `?error=...` redirect we couldn't map (real failure),
- Hydra returned 5xx on the code-exchange (provider outage),
- our own state encoding broke,
- a bare GET to `/callback` from a stray browser navigation.

All four scenarios looked identical on dashboards. The SLO instrumentation in this PR emits a single structured log line per request — `[SLO] auth-callback outcome=<bucket> elapsedMs=<n> ...` — so the cases are separable.

## SLO definition

**Auth-callback completion**: the fraction of `/callback` requests that successfully hand a code back to the downstream client OR cleanly surface an upstream user-driven cancel.

```
SLO = 1 - (bad_outcomes / classified_outcomes)
target: 99.5%  (looser than the refresh SLO; upstream OAuth provider has
                more failure modes outside our control)
window: rolling 28 days
```

## Bucket map

| Outcome | Denominator? | Bad? | Notes |
|---|---|---|---|
| `success` | yes | no | Code exchanged, redirected to client |
| `correct_user_denied` | yes | no | User clicked Cancel at Hydra — `error=access_denied`. System worked correctly. |
| `correct_consent_expired` | yes | no | Hydra `request_unauthorized` — the login/consent challenge DB row expired (`ttl.login_consent_request`, 30m default in Hydra v1.11.x). User took too long between starting auth and clicking Accept; system worked as designed. |
| `correct_csrf_mismatch` | yes | no | Hydra `request_forbidden` — CSRF cookie value differs from the DB row, typically because a concurrent OAuth flow on `oauth2.neon.tech` overwrote the cookie. CSRF guard correctly rejected a corrupted flow; user retries in a single tab and succeeds. See `dev-notes/hydra-incident-2026-05-12T13-44Z.md` §Update for the v1.11.10 source citation (`consent/helper.go:89`). |
| `correct_invalid_grant` | yes | no | Hydra `invalid_grant` on code-exchange — the authorization code was already used or expired (`ttl.auth_code`, 10m default). Mirrors the refresh SLO's same-named bucket. |
| `upstream_unmapped_error` | yes | **yes** | Hydra returned `?error=error&error_description=The error is unrecognizable` (Fosite fallback for unmapped internal state) or any `?error=...` we couldn't classify. **Captures the "user stranded" pattern.** |
| `upstream_other_error` | yes | **yes** | Hydra-mapped OAuth error during code-exchange that isn't 5xx and didn't match one of the `correct_*` classifiers above. New fingerprints land here first; promote to a `correct_*` or keep as bad once characterized. |
| `upstream_5xx` | **no** | n/a | Hydra returned 5xx during the code-exchange (`OAUTH_RESPONSE_IS_NOT_CONFORM`). Excluded — provider-side outage, out of our control. |
| `state_decode_failed` | yes | **yes** | Our own base64/JSON state could not be parsed (we built bad state OR the param got truncated in transit). |
| `bad_request` | **no** | n/a | Callback hit without code/state/error at all — direct navigation, prefetch, browser history. Excluded — not driven by the OAuth flow. |
| `internal_error` | yes | **yes** | KV write failed, Neon API call failed, unexpected shape from openid-client, etc. |

### Why this shape

- **`correct_*` buckets are good, not bad.** When Hydra correctly rejects a flow for a well-understood reason (user clicked Cancel, the 30-minute consent TTL elapsed, a concurrent flow stomped the CSRF cookie, the auth code was already used), the user can retry and succeed without any change on our side. Counting these as failures sets an unachievable ceiling and conflates client-pattern friction with service-quality regressions. The classifier lives in `app/callback/route.ts:classifyUpstreamError`.
- **`upstream_5xx` is excluded, mirroring `transient_upstream_5xx` in the refresh SLO.** Provider outages aren't on our budget.
- **`upstream_unmapped_error` is bad.** Even though the root cause is server-side at Hydra, *users see this break*. The fact that Hydra can't even classify its own error is itself a regression we should be tracking the rate of.
- **`upstream_other_error` is bad until characterized.** This is the "we don't recognize this yet" bucket. When it shows up at non-trivial rate, examine the `upstreamError`/`upstreamErrorDescription` fields, decide if it's a Hydra-side reject for a normal user behavior (→ promote to `correct_*`) or a real failure mode (→ keep bad, possibly split into its own bucket).
- **`bad_request` is excluded.** Bare GETs to `/callback` aren't part of the OAuth flow; counting them inflates traffic without diagnostic value.

## Implementation

### 1. Metric line format

Emitted at every exit point of `app/callback/route.ts`:

```
[SLO] auth-callback outcome=<bucket> elapsedMs=<n> [clientId=<id>] [upstreamError=<code>] [upstreamStatus=<n>] [reason=<short>]
```

Same shape as `[SLO] refresh ...` so the same `vercel logs --query "[SLO] auth-callback"` style queries work.

### 2. How to compute it from logs

Same pattern as `dev-notes/refresh-slo.md` — pull per-bucket JSONL via the Vercel CLI, then aggregate.

```bash
# Run from landing/ so the Vercel project is detected.
for q in "outcome=success" "outcome=correct_user_denied" \
         "outcome=correct_consent_expired" "outcome=correct_csrf_mismatch" \
         "outcome=correct_invalid_grant" \
         "outcome=upstream_unmapped_error" "outcome=upstream_5xx" \
         "outcome=upstream_other_error" "outcome=state_decode_failed" \
         "outcome=bad_request" "outcome=internal_error"; do
  fname=$(echo "$q" | tr ':=' '__')
  vercel logs --since 24h --environment production --no-follow --no-branch \
    --limit 5000 --query "[SLO] auth-callback $q" --json 2>/dev/null \
    > "/tmp/auth-callback-${fname}.jsonl"
done
```

Aggregate the per-bucket JSONL into:

- counts per bucket
- numerator (good) / denominator (good + bad) / SLO percentage
- error budget consumed for the window
- top affected clients in each "bad" bucket (parse `clientId=` from log messages)

The auth-flow volume is **much** lower than the refresh flow (each MCP-client install only triggers one /callback per re-auth event), so a single query per bucket usually fits comfortably under the 5000-row cap for a 24h window. No rate sampling needed at current volume.

### 3. RFC 6749 §4.1.2.1 error relay (shipped with this PR)

When an `?error=...` arrives at `/callback`, we now decode our state, build a redirect URL to the client's `redirect_uri` with `error`, `error_description`, `error_uri`, and the client's original `state` propagated, and 302 there. The MCP client sees the error on its own side instead of the user being stranded on our generic page. The SLO emission happens regardless of relay success.

### 4. Alerting (later)

Once the metric stabilises, alert on:
- `upstream_unmapped_error / classified > 0.5%` over 1 hour — Hydra is producing a non-trivial rate of unmapped errors; needs a server-side look on the upstream side.
- `internal_error / classified > 0.1%` over 1 hour — something on our side broke during exchange.
- Any non-zero `state_decode_failed` over 1 hour — either a regression in our state encoding or a tampering attempt.
