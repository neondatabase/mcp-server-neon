import { Clock, Effect, Predicate } from 'effect';
import type { Token } from 'oauth2-server';
import { RefreshFailed } from './refresh-failed';
import { cacheResult, cleanUp, persistPair } from './refresh-persist';
import type { IssuedPair } from './refresh-persist';
import { toMilliseconds, toSeconds } from './refresh-token-result';
import { exchange } from './refresh-upstream-failure';
import type { Rotation } from './refresh-upstream-failure';
import type { exchangeRefreshTokenUpstream } from './upstream-refresh';

type UpstreamTokens = Effect.Success<
  ReturnType<typeof exchangeRefreshTokenUpstream>
>;

const scopeOf = (token: Token): string | string[] | undefined => {
  const { scope } = token;

  return Predicate.isString(scope) || Array.isArray(scope) ? scope : undefined;
};

const missingAccessToken = (tokens: UpstreamTokens) =>
  Effect.logError('Upstream token missing access_token').pipe(
    Effect.annotateLogs({
      hasAccessToken: Boolean(tokens.access_token),
      hasRefreshToken: Boolean(tokens.refresh_token),
    }),
    Effect.andThen(
      Effect.fail(
        RefreshFailed.make({
          outcome: 'transient_persist_failure',
          status: 502,
          error: 'server_error',
          description: 'Invalid token response from upstream',
        }),
      ),
    ),
  );

const invalidExpiry = (input: {
  readonly expiresAt: number;
  readonly now: number;
  readonly expiresIn: number;
}) =>
  Effect.logError('Invalid expiresIn calculated').pipe(
    Effect.annotateLogs(input),
    Effect.andThen(
      Effect.fail(
        RefreshFailed.make({
          outcome: 'transient_persist_failure',
          status: 500,
          error: 'server_error',
          description: 'Invalid token expiration',
        }),
      ),
    ),
  );

// We commit to the upstream pair regardless of what happens during
// persistence: the next phase makes our storage agree with what we tell the
// client, but if it can't, the client's tokens are still valid upstream.
const issuedPair = Effect.fnUntraced(function* (input: {
  readonly rotation: Rotation;
  readonly tokens: UpstreamTokens;
}) {
  const { rotation, tokens } = input;
  const now = yield* Clock.currentTimeMillis;
  const upstreamExpiresIn = tokens.expiresIn();

  if (upstreamExpiresIn === undefined) {
    yield* Effect.logError(
      'Upstream omitted expires_in on refresh; defaulting to 3600s',
    ).pipe(Effect.annotateLogs({ clientId: rotation.client.id }));
  }

  const expiresAt = now + toMilliseconds(upstreamExpiresIn ?? 3600);
  const refreshToken = tokens.refresh_token ?? rotation.record.refreshToken;

  if (!tokens.access_token) {
    return yield* missingAccessToken(tokens);
  }

  const expiresIn = toSeconds(expiresAt - now);

  if (!Number.isFinite(expiresIn)) {
    return yield* invalidExpiry({ expiresAt, now, expiresIn });
  }

  const pair: IssuedPair = {
    accessToken: tokens.access_token,
    refreshToken,
    expiresAt,
    result: {
      access_token: tokens.access_token,
      expires_in: expiresIn,
      token_type: 'bearer',
      refresh_token: refreshToken,
      scope: scopeOf(rotation.oldToken),
    },
  };

  return pair;
});

const scopeType = (scope: string | string[] | undefined) => {
  if (scope === undefined) {
    return 'undefined';
  }

  return Array.isArray(scope) ? 'object' : 'string';
};

/**
 * Forwards the stored refresh token upstream and makes storage agree with
 * the pair upstream issued. Callers run it uninterruptibly: once Hydra may
 * have rotated the token, stopping before the new pair is cached and
 * persisted would leave the client holding a dead token.
 */
export const rotateUpstream = Effect.fnUntraced(function* (rotation: Rotation) {
  const tokens = yield* exchange(rotation);
  const pair = yield* issuedPair({ rotation, tokens });

  yield* cacheResult({ rotation, pair });
  yield* persistPair({ rotation, pair });
  yield* cleanUp({ rotation, pair });

  yield* Effect.logInfo('Refresh token exchanged successfully');

  const { result } = pair;

  yield* Effect.logInfo('Building refresh token response').pipe(
    Effect.annotateLogs({
      hasAccessToken: Boolean(result.access_token),
      hasRefreshToken: Boolean(result.refresh_token),
      expiresIn: result.expires_in,
      scopeType: scopeType(result.scope),
      scopeIsArray: Array.isArray(result.scope),
    }),
  );

  return result;
});
