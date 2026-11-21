import { Clock, Effect, Schema } from 'effect';
import type { Client } from 'oauth2-server';
import { detectClientApplication } from '../utils/client-application';
import type { ClientApplication } from '../utils/client-application';
import type { RefreshReplay } from './refresh-result';

/**
 * Outcome bucket for the refresh-token SLO. See ai-notes/refresh-slo.md.
 *
 * - `success`                    — 200 returned (fresh upstream rotation OR
 *                                  cached cross-instance hit). Counts good.
 * - `correct_invalid_grant`      — 400; client presented a token we knew was
 *                                  dead (RT-not-found, failure-cache hit, etc.)
 *                                  Counts good — our system did the right thing.
 * - `cliff_upstream`             — 4xx from upstream Hydra. Counts BAD —
 *                                  the chain is now revoked, user must re-auth.
 * - `transient_lock_timeout`     — 503 from lock-waiter timeout. Counts BAD.
 * - `transient_persist_failure`  — KV write threw after upstream rotated.
 *                                  Counts BAD — leaks rotation state.
 * - `transient_upstream_5xx`     — Hydra returned an HTTP 5xx response.
 *                                  Excluded from SLO (provider issue).
 * - `transient_upstream_network` — Network-level error reaching Hydra
 *                                  (ECONNRESET, ETIMEDOUT, ENOTFOUND, etc.).
 *                                  Distinguished from 5xx because it's
 *                                  retryable from our side and a different
 *                                  diagnostic category. Excluded from SLO.
 * - `bad_request`                — request validation failure. Excluded.
 */
export const SloOutcome = Schema.Literals([
  'success',
  'correct_invalid_grant',
  'cliff_upstream',
  'transient_lock_timeout',
  'transient_persist_failure',
  'transient_upstream_5xx',
  'transient_upstream_network',
  'bad_request',
]);

export type SloOutcome = typeof SloOutcome.Type;

type LoggedReplay = RefreshReplay & { clientApplication: ClientApplication };

export const loggedReplay = (
  replay: RefreshReplay | undefined,
  client: Client,
): LoggedReplay | undefined =>
  replay === undefined
    ? undefined
    : {
        ...replay,
        clientApplication: detectClientApplication(client.client_name),
      };

// An empty field is left out, like a missing one.
const truthy = (value: string | undefined): value is string =>
  value !== undefined && value !== '';

const sloFields = (input: {
  readonly outcome: SloOutcome;
  readonly elapsedMs: number;
  readonly clientId?: string;
  readonly reason?: string;
  readonly upstreamOauthError?: string;
  readonly replay?: LoggedReplay;
}): string[] => {
  const { replay } = input;
  const fields = [`outcome=${input.outcome}`, `elapsedMs=${input.elapsedMs}`];

  if (truthy(input.clientId)) {
    fields.push(`clientId=${input.clientId}`);
  }

  if (replay === undefined && truthy(input.reason)) {
    fields.push(`reason=${input.reason}`);
  }

  if (replay !== undefined) {
    fields.push(
      'reason=replay_after_grace',
      `replayAgeMs=${replay.ageMs}`,
      `replayNext=${replay.next}`,
      `clientApplication=${replay.clientApplication}`,
    );
  }

  if (truthy(input.upstreamOauthError)) {
    fields.push(`upstreamOauthError=${input.upstreamOauthError}`);
  }

  return fields;
};

/**
 * Stable, greppable SLO metric line. Aggregator scripts parse the
 * `outcome=<bucket>` token; other fields are diagnostic context.
 */
export const emitRefreshSlo = Effect.fnUntraced(function* (input: {
  readonly outcome: SloOutcome;
  readonly startMs: number;
  readonly clientId?: string;
  readonly reason?: string;
  readonly upstreamOauthError?: string;
  readonly replay?: LoggedReplay;
}) {
  const now = yield* Clock.currentTimeMillis;
  const line = `[SLO] refresh ${sloFields({ ...input, elapsedMs: now - input.startMs }).join(' ')}`;
  const { replay } = input;

  if (replay === undefined) {
    yield* Effect.logInfo(line);

    return;
  }

  // Sentry Logs attributes, so replays can be counted per client and app.
  // Names containing "auth" or "token" are scrubbed to [Filtered].
  yield* Effect.logInfo(line).pipe(
    Effect.annotateLogs({
      clientId: input.clientId,
      replayAgeMs: replay.ageMs,
      replayNext: replay.next,
      clientApplication: replay.clientApplication,
    }),
  );
});
