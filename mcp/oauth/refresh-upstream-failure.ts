import { Clock, Effect } from 'effect';
import type { Client, Token } from 'oauth2-server';
import type { UpstreamOAuthFailed } from '../../lib/oauth/upstream-oauth-failed';
import type { RefreshToken } from './kv-store';
import { OAuthStore } from './oauth-store';
import { RefreshFailed } from './refresh-failed';
import type { ReleaseHint } from './refresh-lock-service';
import { RefreshRotations } from './refresh-rotations';
import {
  exchangeRefreshTokenUpstream,
  networkFailureCode,
} from './upstream-refresh';
import type { UpstreamTimeoutError } from './upstream-timeout-error';

/** A stored refresh token of `client`'s, about to be sent upstream. */
export type Rotation = {
  readonly familyId: string;
  readonly refreshToken: string;
  readonly client: Client;
  readonly record: RefreshToken;
  readonly oldToken: Token;
  readonly release: ReleaseHint;
};

const upstreamRejected = Effect.fnUntraced(function* (input: {
  readonly rotation: Rotation;
  readonly failure: UpstreamOAuthFailed;
}) {
  const { rotation } = input;
  const { details } = input.failure;
  const rotations = yield* RefreshRotations;
  const store = yield* OAuthStore;
  const failedAt = yield* Clock.currentTimeMillis;

  // Cache the dead RT so subsequent retries from the same client (which
  // we've observed firing 100-500 requests in sub-second bursts) get a fast
  // 400 from KV instead of stampeding upstream.
  yield* rotations
    .recordFailure({
      refreshToken: rotation.refreshToken,
      failure: {
        failedAt,
        oauthError: details.oauthError,
        oauthErrorDescription: details.oauthErrorDescription,
      },
    })
    .pipe(
      Effect.catchTag('OAuthStoreUnavailable', ({ cause }) =>
        Effect.logWarning('Failed to cache refresh failure').pipe(
          Effect.annotateLogs({ err: cause }),
        ),
      ),
    );

  yield* store.deleteAccessToken({ token: rotation.oldToken });
  yield* store.deleteRefreshToken({ refreshToken: rotation.record });

  return yield* RefreshFailed.make({
    outcome: 'cliff_upstream',
    status: 400,
    error: 'invalid_grant',
    description: 'Invalid or expired refresh token',
    upstreamOauthError: details.oauthError,
  });
});

// Network-layer failures (no HTTP response) and HTTP 5xx are told apart for
// SLO bucketing: both are excluded from the SLO, but network volume points at
// TCP/DNS health and 5xx volume at Hydra's.
const upstreamUnavailable = Effect.fnUntraced(function* (input: {
  readonly rotation: Rotation;
  readonly failure: UpstreamOAuthFailed | UpstreamTimeoutError;
}) {
  // Waiters exit their poll loop fast instead of timing out as 503s. The
  // marker is written atomically with the lock release: as two separate
  // writes, a waiter can see the release before the marker, which
  // manifested as 12 cascaded `transient_lock_timeout` events during the
  // 2026-05-08 07:17 UTC Hydra burst.
  yield* input.rotation.release.markTransientForWaiters;

  if (networkFailureCode(input.failure) !== undefined) {
    return yield* RefreshFailed.make({
      outcome: 'transient_upstream_network',
      status: 503,
      error: 'server_error',
      description: 'Network error contacting upstream; please retry',
    });
  }

  return yield* RefreshFailed.make({
    outcome: 'transient_upstream_5xx',
    status: 503,
    error: 'server_error',
    description: 'Temporary error refreshing token, please retry',
  });
});

/**
 * Sends the stored refresh token upstream. A 4xx is a cliff: the token is
 * dead, so it is cached as failed and its records are deleted. Anything else
 * is an upstream outage the waiters are told about.
 */
export const exchange = (rotation: Rotation) =>
  exchangeRefreshTokenUpstream({
    refreshToken: rotation.record.refreshToken,
    clientId: rotation.client.id,
  }).pipe(
    Effect.catchTags({
      UpstreamOAuthFailed: (failure) =>
        failure.rejected
          ? upstreamRejected({ rotation, failure })
          : upstreamUnavailable({ rotation, failure }),
      UpstreamTimeoutError: (failure) =>
        upstreamUnavailable({ rotation, failure }),
    }),
  );
