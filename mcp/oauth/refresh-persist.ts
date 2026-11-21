import { Effect } from 'effect';
import { retryLogged } from './logged-retry';
import { OAuthStore } from './oauth-store';
import { OAuthStoreUnavailable } from './oauth-store-unavailable';
import { RefreshFailed } from './refresh-failed';
import { RefreshRotations } from './refresh-rotations';
import type { RefreshTokenResult } from './refresh-token-result';
import type { Rotation } from './refresh-upstream-failure';

/** The pair upstream issued, as the client will receive it. */
export type IssuedPair = {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly result: RefreshTokenResult;
};

const failureText = ({ cause }: OAuthStoreUnavailable) =>
  cause instanceof Error ? cause.message : String(cause);

// Written BEFORE the new pair is persisted: if persisting fails, peers (and
// this client's retries with the OLD refresh_token) can still serve the new
// pair from this cache. Otherwise a Postgres blip during persist would leak
// the rotation: Hydra has advanced but our system has no record, so any
// retry hits upstream again and gets `token_inactive`.
export const cacheResult = Effect.fnUntraced(function* (input: {
  readonly rotation: Rotation;
  readonly pair: IssuedPair;
}) {
  const { rotation, pair } = input;
  const rotations = yield* RefreshRotations;

  yield* rotations
    .recordResult({
      refreshToken: rotation.refreshToken,
      result: {
        clientId: rotation.client.id,
        accessToken: pair.accessToken,
        refreshToken: pair.refreshToken,
        expiresAt: pair.expiresAt,
        scope: pair.result.scope,
      },
    })
    .pipe(
      Effect.catchTag('OAuthStoreUnavailable', ({ cause }) =>
        Effect.logWarning('Failed to cache refresh result').pipe(
          Effect.annotateLogs({ err: cause }),
        ),
      ),
    );
});

const saveIssuedPair = (input: {
  readonly rotation: Rotation;
  readonly pair: IssuedPair;
}) =>
  Effect.gen(function* () {
    const { pair } = input;
    const { client, oldToken } = input.rotation;
    const store = yield* OAuthStore;
    const grant: unknown = oldToken.grant;

    const saved = yield* store.saveTokenPair({
      token: {
        accessToken: pair.accessToken,
        refreshToken: pair.refreshToken,
        expires_at: pair.expiresAt,
        client,
        user: oldToken.user,
        scope: oldToken.scope,
        grant,
      },
      refreshToken: pair.refreshToken,
    });

    if (!saved.accessToken) {
      return yield* OAuthStoreUnavailable.make({
        operation: 'saveToken',
        cause: 'saveToken returned token without accessToken',
      });
    }
  });

// Most persist failures are transient (Postgres connection blip, deadlock,
// brief unavailability) and clear within milliseconds, so three quick
// attempts catch them without piling latency on the success path. If all
// fail, the refresh fails as `transient_persist_failure`; the route then
// serves the pair from the success cache written above, the degraded path.
export const persistPair = Effect.fnUntraced(function* (input: {
  readonly rotation: Rotation;
  readonly pair: IssuedPair;
}) {
  const { client } = input.rotation;

  yield* Effect.logInfo('Saving new tokens from refresh');

  yield* retryLogged({
    attempt: saveIssuedPair(input),
    op: 'persist refresh result',
    delaysMs: [50, 250],
    retryable: () => true,
    describe: failureText,
  }).pipe(
    Effect.catchTag('OAuthStoreUnavailable', (failure) =>
      Effect.logError(
        'Persist after upstream rotation failed (after retry)',
      ).pipe(
        Effect.annotateLogs({ err: failureText(failure), clientId: client.id }),
        Effect.andThen(
          Effect.fail(
            RefreshFailed.make({
              outcome: 'transient_persist_failure',
              status: 500,
              error: 'server_error',
              description: 'Failed to persist refreshed tokens',
              cause: failure,
            }),
          ),
        ),
      ),
    ),
    Effect.withSpan('RefreshToken.persist'),
  );
});

// Best effort: the old tokens TTL out and the new ones are already live.
export const cleanUp = Effect.fnUntraced(function* (input: {
  readonly rotation: Rotation;
  readonly pair: IssuedPair;
}) {
  const { rotation, pair } = input;
  const store = yield* OAuthStore;

  yield* store
    .deleteAccessToken({ token: rotation.oldToken })
    .pipe(
      Effect.catchTag('OAuthStoreUnavailable', ({ cause }) =>
        Effect.logWarning('Failed to delete old access token').pipe(
          Effect.annotateLogs({ err: cause }),
        ),
      ),
    );

  if (pair.refreshToken !== rotation.record.refreshToken) {
    yield* store
      .deleteRefreshToken({ refreshToken: rotation.record })
      .pipe(
        Effect.catchTag('OAuthStoreUnavailable', ({ cause }) =>
          Effect.logWarning('Failed to delete old refresh token').pipe(
            Effect.annotateLogs({ err: cause }),
          ),
        ),
      );
  }
});
