import { Clock, Effect, Option } from 'effect';
import type { Client } from 'oauth2-server';
import type { RefreshToken } from './kv-store';
import { OAuthStore } from './oauth-store';
import { invalidRefreshGrant, withRefreshSpan } from './refresh-failed';
import type { ReleaseHint } from './refresh-lock-service';
import type { RotationOutcome } from './refresh-result';
import { RefreshRotations } from './refresh-rotations';
import { rotateUpstream } from './refresh-rotate';
import { cachedToResponse } from './refresh-token-result';

type Refresh = {
  readonly refreshToken: string;
  readonly client: Client;
  readonly release: ReleaseHint;
};

// When a holder bails out before the upstream call (RT/AT not found in KV,
// client mismatch, etc.), populate the failure cache too — otherwise
// concurrent waiters time out with a 503 instead of getting the actual 400
// invalid_grant. Outcome of these checks is durable: an RT we don't have in
// storage will not suddenly become valid, so caching is correct.
const cachePreUpstreamFailure = Effect.fnUntraced(function* (input: {
  readonly refreshToken: string;
  readonly reason: string;
  readonly clientId?: string;
}) {
  const { refreshToken, reason } = input;
  const rotations = yield* RefreshRotations;
  const failedAt = yield* Clock.currentTimeMillis;

  yield* rotations
    .recordFailure({
      refreshToken,
      failure: {
        clientId: input.clientId,
        failedAt,
        oauthError: 'invalid_grant',
        oauthErrorDescription: reason,
      },
    })
    .pipe(
      Effect.catchTag('OAuthStoreUnavailable', ({ cause }) =>
        Effect.logWarning('Failed to cache pre-upstream refresh failure').pipe(
          Effect.annotateLogs({ err: cause, reason }),
        ),
      ),
    );
});

const answerOwnedRotation = Effect.fnUntraced(function* (input: {
  readonly refreshToken: string;
  readonly outcome: RotationOutcome;
}) {
  const { outcome } = input;

  if (outcome.kind === 'serve') {
    const now = yield* Clock.currentTimeMillis;

    return cachedToResponse({ cached: outcome.result, now });
  }

  yield* cachePreUpstreamFailure({
    refreshToken: input.refreshToken,
    reason: 'replay_after_grace',
  });

  return yield* invalidRefreshGrant(outcome.replay);
});

const accessTokenMissing = Effect.fnUntraced(function* (input: {
  readonly refreshToken: string;
  readonly record: RefreshToken;
}) {
  const { refreshToken } = input;
  const store = yield* OAuthStore;

  // info, not warn: same `correct_invalid_grant` happy path as a refresh
  // token missing from storage — AT was cleared out of KV (rotation cleanup
  // or TTL); we tidy up and return a clean 400 invalid_grant.
  yield* Effect.logInfo(
    'Access token for refresh token not found, cleaning up',
  );
  yield* store.deleteRefreshToken({ refreshToken: input.record });
  yield* cachePreUpstreamFailure({
    refreshToken,
    reason: 'access_token_not_found',
  });

  return yield* invalidRefreshGrant();
});

const clientMismatch = Effect.fnUntraced(function* (input: {
  readonly refreshToken: string;
  readonly tokenClientId: string;
  readonly requestClientId: string;
}) {
  const { tokenClientId, requestClientId } = input;

  yield* Effect.logWarning('Client mismatch for refresh token').pipe(
    Effect.annotateLogs({ tokenClientId, requestClientId }),
  );
  // The token may still be valid for its owner, so the failure only rejects
  // this client's retries.
  yield* cachePreUpstreamFailure({
    refreshToken: input.refreshToken,
    reason: 'client_mismatch',
    clientId: requestClientId,
  });

  return yield* invalidRefreshGrant();
});

/** The stored token pair `refreshToken` renews, when it is `client`'s. */
const storedPair = Effect.fnUntraced(function* (input: {
  readonly refreshToken: string;
  readonly client: Client;
}) {
  const { refreshToken, client } = input;
  const store = yield* OAuthStore;
  const record = yield* store.findRefreshToken({ refreshToken });

  if (Option.isNone(record)) {
    // info, not warn: this is the canonical happy path for
    // `correct_invalid_grant` (client presents an RT we've never seen / have
    // already cleared from KV). Counted as "good" in the SLO. Warn-level
    // pollutes error dashboards with normal traffic.
    yield* Effect.logInfo('Refresh token not found in storage');
    yield* cachePreUpstreamFailure({
      refreshToken,
      reason: 'rt_not_found_in_storage',
    });

    return yield* invalidRefreshGrant();
  }

  const oldToken = yield* store.findAccessToken({
    accessToken: record.value.accessToken,
  });

  if (Option.isNone(oldToken)) {
    return yield* accessTokenMissing({ refreshToken, record: record.value });
  }

  if (oldToken.value.client.id !== client.id) {
    return yield* clientMismatch({
      refreshToken,
      tokenClientId: oldToken.value.client.id,
      requestClientId: client.id,
    });
  }

  return { record: record.value, oldToken: oldToken.value };
});

/**
 * The lock holder's refresh of `refreshToken` for `client`. From the moment
 * the token is sent upstream the rest runs uninterruptibly.
 */
export const executeRefresh = (input: Refresh) =>
  Effect.gen(function* () {
    const { refreshToken, client } = input;
    const rotations = yield* RefreshRotations;
    // Before the storage lookup: a failed cleanup after the rotation leaves
    // the old token's records in place, and sending that token upstream
    // would make Hydra revoke the chain it rotated into. This also runs when
    // the refresh lock is unavailable and no peek happened.
    const owned = yield* rotations.resolveOwned({ refreshToken, client });

    if (Option.isSome(owned)) {
      return yield* answerOwnedRotation({ refreshToken, outcome: owned.value });
    }

    const pair = yield* storedPair({ refreshToken, client });

    return yield* rotateUpstream({ ...input, ...pair });
  }).pipe(withRefreshSpan('RefreshToken.execute'));
