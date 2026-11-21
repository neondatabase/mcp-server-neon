import { Clock, Effect, Option } from 'effect';
import type { Client } from 'oauth2-server';
import { executeRefresh } from '../../../mcp/oauth/refresh-execute';
import {
  RefreshFailed,
  invalidRefreshGrant,
} from '../../../mcp/oauth/refresh-failed';
import { RefreshInflight } from '../../../mcp/oauth/refresh-inflight';
import { RefreshLock } from '../../../mcp/oauth/refresh-lock-service';
import type {
  RefreshReplay,
  RotationOutcome,
} from '../../../mcp/oauth/refresh-result';
import { RefreshRotations } from '../../../mcp/oauth/refresh-rotations';
import { cachedToResponse } from '../../../mcp/oauth/refresh-token-result';

/** A refresh_token grant request: the token, its client, and when it began. */
export type Grant = {
  readonly refreshToken: string;
  readonly client: Client;
  readonly startMs: number;
};

export const rejectedReplay = (
  outcome: Option.Option<RotationOutcome>,
): RefreshReplay | undefined =>
  Option.isSome(outcome) && outcome.value.kind === 'reject'
    ? outcome.value.replay
    : undefined;

export const servedPair = (outcome: Option.Option<RotationOutcome>) =>
  Option.isSome(outcome) && outcome.value.kind === 'serve'
    ? Option.some(outcome.value.result)
    : Option.none();

/** The pair a winning peer's rotation cached for this client, if any. */
export const checkSuccessCache = Effect.fnUntraced(function* (grant: Grant) {
  const rotations = yield* RefreshRotations;
  const cached = yield* rotations.ownedResult(grant);
  const now = yield* Clock.currentTimeMillis;

  return cached.pipe(
    Option.map((result) => cachedToResponse({ cached: result, now })),
  );
});

/**
 * What a lock waiter polls. The failure cache wins: a token a peer marked
 * dead (upstream 4xx or missing from storage), or that this client already
 * failed the client check for, is answered 400 at once instead of after the
 * lock-wait timeout as 503.
 */
const peekResolution = Effect.fnUntraced(function* (grant: Grant) {
  const { refreshToken } = grant;
  const rotations = yield* RefreshRotations;
  const lock = yield* RefreshLock;
  const failure = yield* rotations.cachedFailure(grant);

  if (Option.isSome(failure)) {
    const owned = yield* rotations.attributedOutcome(grant);
    const served = servedPair(owned);

    if (Option.isNone(served)) {
      return yield* owned.pipe(rejectedReplay, invalidRefreshGrant);
    }

    const now = yield* Clock.currentTimeMillis;

    return Option.some(cachedToResponse({ cached: served.value, now }));
  }

  // The holder hit an upstream 5xx and signalled "don't wait, retry
  // shortly", so the waiter answers 503 now instead of polling for seconds.
  if (yield* lock.hasTransientFailure({ refreshToken })) {
    return yield* RefreshFailed.make({
      outcome: 'transient_upstream_5xx',
      status: 503,
      error: 'server_error',
      description: 'Upstream temporarily unavailable; please retry',
    });
  }

  return yield* checkSuccessCache(grant);
});

// The cross-instance lock keeps two instances from both forwarding the same
// token to Hydra and triggering its reuse detection, which revokes the whole
// chain; a waiter returns as soon as the holder caches the result. Inside the
// lock, same-instance concurrent calls share one refresh.
export const refreshUnderLock = Effect.fnUntraced(function* (grant: Grant) {
  const { refreshToken, client } = grant;
  const lock = yield* RefreshLock;
  const inflight = yield* RefreshInflight;

  return yield* lock.withLock({
    refreshToken,
    peek: peekResolution(grant),
    execute: (release) =>
      inflight.dedupe({
        key: JSON.stringify(['refresh', client.id, refreshToken]),
        refresh: executeRefresh({ refreshToken, client, release }),
      }),
  });
});
