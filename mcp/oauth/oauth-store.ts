import { Context, Effect, Layer, Option } from 'effect';
import type { AuthorizationCode, Client, Token } from 'oauth2-server';
import { ClientMetadataUnavailableError } from '../../lib/oauth/client-id-metadata-document';
import {
  ClientMetadataUnavailable,
  withSpanOkOnClientOutage,
} from '../../lib/oauth/client-metadata-unavailable';
import { withPgConnectRetry } from './kv-store';
import type { RefreshToken } from './kv-store';
import { model } from './model';
import { OAuthStoreUnavailable } from './oauth-store-unavailable';
import { revokeOwnedRotation } from './refresh-result';

// One span per store round trip, so a slow revocation shows which one.
const stored = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => OAuthStoreUnavailable.make({ operation, cause }),
  }).pipe(Effect.withSpan(`OAuthModel.${operation}`));

/** RFC 7009 `token_type_hint`; any other value revokes nothing. */
type TokenTypeHint = Option.Option<string>;

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

/** OAuth clients and the tokens issued to them. */
export class OAuthStore extends Context.Service<
  OAuthStore,
  {
    readonly saveClient: (input: {
      readonly client: Client;
      readonly registerHeaders: Record<string, string>;
    }) => Effect.Effect<void, OAuthStoreUnavailable>;
    /**
     * A registered client, or the client a metadata document URL describes.
     * None for an unknown client or a refused document.
     */
    readonly findClient: (input: {
      readonly clientId: string;
    }) => Effect.Effect<
      Option.Option<Client>,
      OAuthStoreUnavailable | ClientMetadataUnavailable
    >;
    readonly findAuthorizationCode: (input: {
      readonly code: string;
    }) => Effect.Effect<
      Option.Option<AuthorizationCode>,
      OAuthStoreUnavailable
    >;
    /** Retried once on a Postgres connect failure, like every callback write. */
    readonly saveAuthorizationCode: (input: {
      readonly code: AuthorizationCode;
    }) => Effect.Effect<void, OAuthStoreUnavailable>;
    /** An authorization code is single-use. */
    readonly consumeAuthorizationCode: (input: {
      readonly code: AuthorizationCode;
    }) => Effect.Effect<void, OAuthStoreUnavailable>;
    /** Stores an issued access token and the refresh token that renews it. */
    readonly saveTokenPair: (input: {
      readonly token: Token;
      readonly refreshToken: string;
    }) => Effect.Effect<Token, OAuthStoreUnavailable>;
    readonly findAccessToken: (input: {
      readonly accessToken: string;
    }) => Effect.Effect<Option.Option<Token>, OAuthStoreUnavailable>;
    readonly findRefreshToken: (input: {
      readonly refreshToken: string;
    }) => Effect.Effect<Option.Option<RefreshToken>, OAuthStoreUnavailable>;
    readonly deleteAccessToken: (input: {
      readonly token: Token;
    }) => Effect.Effect<void, OAuthStoreUnavailable>;
    readonly deleteRefreshToken: (input: {
      readonly refreshToken: RefreshToken;
    }) => Effect.Effect<void, OAuthStoreUnavailable>;
    /** RFC 7009 revocation by the owning client; unknown tokens are a no-op. */
    readonly revokeToken: (input: {
      readonly token: string;
      readonly tokenTypeHint: TokenTypeHint;
      readonly clientId: string;
    }) => Effect.Effect<void, OAuthStoreUnavailable>;
  }
>()('@neondatabase/mcp-server-neon/mcp/oauth/oauth-store/OAuthStore', {
  make: Effect.succeed({
    saveClient: Effect.fn('OAuthStore.saveClient')(function* (input: {
      readonly client: Client;
      readonly registerHeaders: Record<string, string>;
    }) {
      const { client, registerHeaders } = input;

      yield* stored('saveClient', async () => model.saveClient(client));
      yield* stored('saveClientRegisterHeaders', async () =>
        model.saveClientRegisterHeaders(client.id, registerHeaders),
      );
    }),

    findClient: (input: { readonly clientId: string }) =>
      Effect.tryPromise({
        try: async () => model.getClient(input.clientId, ''),
        catch: (cause) =>
          cause instanceof ClientMetadataUnavailableError
            ? ClientMetadataUnavailable.make({ cause })
            : OAuthStoreUnavailable.make({ operation: 'getClient', cause }),
      }).pipe(
        Effect.map(Option.fromUndefinedOr),
        withSpanOkOnClientOutage('OAuthStore.findClient'),
      ),

    findAuthorizationCode: ({ code }: { readonly code: string }) =>
      stored('getAuthorizationCode', async () =>
        model.getAuthorizationCode(code),
      ).pipe(
        Effect.map(Option.fromUndefinedOr),
        Effect.withSpan('OAuthStore.findAuthorizationCode'),
      ),

    saveAuthorizationCode: ({ code }: { readonly code: AuthorizationCode }) =>
      stored('saveAuthorizationCode', async () =>
        withPgConnectRetry('callback.saveAuthorizationCode', async () =>
          model.saveAuthorizationCode(code),
        ),
      ).pipe(
        Effect.asVoid,
        Effect.withSpan('OAuthStore.saveAuthorizationCode'),
      ),

    consumeAuthorizationCode: ({
      code,
    }: {
      readonly code: AuthorizationCode;
    }) =>
      stored('revokeAuthorizationCode', async () =>
        model.revokeAuthorizationCode(code),
      ).pipe(
        Effect.asVoid,
        Effect.withSpan('OAuthStore.consumeAuthorizationCode'),
      ),

    saveTokenPair: Effect.fn('OAuthStore.saveTokenPair')(function* (input: {
      readonly token: Token;
      readonly refreshToken: string;
    }) {
      const saved = yield* stored('saveToken', async () =>
        model.saveToken(input.token),
      );

      yield* stored('saveRefreshToken', async () =>
        model.saveRefreshToken({
          refreshToken: input.refreshToken,
          accessToken: saved.accessToken,
        }),
      );

      return saved;
    }),

    findAccessToken: ({ accessToken }: { readonly accessToken: string }) =>
      stored('getAccessToken', async () =>
        model.getAccessToken(accessToken),
      ).pipe(Effect.map(Option.fromUndefinedOr)),

    findRefreshToken: ({ refreshToken }: { readonly refreshToken: string }) =>
      stored('getRefreshToken', async () =>
        model.getRefreshToken(refreshToken),
      ).pipe(Effect.map(Option.fromUndefinedOr)),

    deleteAccessToken: ({ token }: { readonly token: Token }) =>
      stored('deleteToken', async () => model.deleteToken(token)).pipe(
        Effect.asVoid,
      ),

    deleteRefreshToken: ({
      refreshToken,
    }: {
      readonly refreshToken: RefreshToken;
    }) =>
      stored('deleteRefreshToken', async () =>
        model.deleteRefreshToken(refreshToken),
      ).pipe(Effect.asVoid),

    revokeToken: Effect.fn('OAuthStore.revokeToken')(function* (input: {
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
    }),
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
