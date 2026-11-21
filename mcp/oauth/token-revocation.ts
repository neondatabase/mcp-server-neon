import { Effect, Option } from 'effect';
import { model } from './model';
import { revokeOwnedRotation } from './refresh-result';
import { stored } from './stored';

/** RFC 7009 `token_type_hint`; any other value revokes nothing. */
export type TokenTypeHint = Option.Option<string>;

const revokesRefreshToken = (hint: TokenTypeHint) =>
  Option.isNone(hint) || hint.value === 'refresh_token';

const revokesAccessToken = (hint: TokenTypeHint) =>
  Option.isNone(hint) || hint.value === 'access_token';

/** Deletes the access token when `clientId` owns it. */
const revokeAccessToken = Effect.fnUntraced(function* (input: {
  readonly accessToken: string;
  readonly clientId: string;
}) {
  const access = yield* stored('getAccessToken', async () =>
    model.getAccessToken(input.accessToken),
  );

  if (access === undefined || access.client.id !== input.clientId) {
    return false;
  }

  yield* stored('deleteToken', async () => model.deleteToken(access));

  return true;
});

/**
 * A refresh token is revoked with the access token it was issued with, and
 * only by the client that owns them. A rotated refresh token still returns
 * its cached pair while that pair is unused, so revoking it ends the cached
 * rotation too.
 */
const revokeRefreshToken = Effect.fnUntraced(function* (input: {
  readonly token: string;
  readonly clientId: string;
}) {
  const { token, clientId } = input;

  const rotationRevoked = yield* stored('revokeOwnedRotation', async () =>
    revokeOwnedRotation(token, clientId),
  );

  if (rotationRevoked) {
    yield* Effect.logInfo('Token revoked').pipe(
      Effect.annotateLogs({ clientId, type: 'rotated_refresh_token' }),
    );
  }

  const refresh = yield* stored('getRefreshToken', async () =>
    model.getRefreshToken(token),
  );

  if (refresh === undefined) {
    return Option.none();
  }

  const access = yield* stored('getAccessToken', async () =>
    model.getAccessToken(refresh.accessToken),
  );

  if (access !== undefined && access.client.id === clientId) {
    // Once the access token is gone, a later revocation can no longer find
    // the refresh token's owner, so both deletes run even if the request is
    // aborted between them.
    yield* Effect.uninterruptible(
      stored('deleteToken', async () => model.deleteToken(access)).pipe(
        Effect.andThen(
          stored('deleteRefreshToken', async () =>
            model.deleteRefreshToken(refresh),
          ),
        ),
      ),
    );
    yield* Effect.logInfo('Token revoked').pipe(
      Effect.annotateLogs({ clientId, type: 'refresh_token' }),
    );
  }

  return Option.some(refresh);
});

export const revokeToken = Effect.fn('OAuthStore.revokeToken')(
  function* (input: {
    readonly token: string;
    readonly tokenTypeHint: TokenTypeHint;
    readonly clientId: string;
  }) {
    const { token, tokenTypeHint, clientId } = input;

    if (revokesRefreshToken(tokenTypeHint)) {
      const refresh = yield* revokeRefreshToken({ token, clientId });

      if (Option.isSome(refresh)) {
        return;
      }
    }

    if (revokesAccessToken(tokenTypeHint)) {
      const revoked = yield* revokeAccessToken({
        accessToken: token,
        clientId,
      });

      if (revoked) {
        yield* Effect.logInfo('Token revoked').pipe(
          Effect.annotateLogs({ clientId, type: 'access_token' }),
        );
      }
    }
  },
);
