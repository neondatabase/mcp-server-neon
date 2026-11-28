import { Context, Effect, Layer, Option, Predicate } from 'effect';
import type { AuthorizationCode, Client, Token } from 'oauth2-server';
import { ClientMetadataUnavailableError } from '../../lib/oauth/client-id-metadata-document';
import {
  ClientMetadataUnavailable,
  withSpanOkOnClientOutage,
} from '../../lib/oauth/client-metadata-unavailable';
import type { ClientRegisterHeadersRecord, RefreshToken } from './kv-store';
import { model } from './model';
import { OAuthStoreUnavailable } from './oauth-store-unavailable';
import { retryPgConnect } from './pg-connect-retry';
import { stored } from './stored';
import { revokeToken } from './token-revocation';
import type { TokenTypeHint } from './token-revocation';

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
      /** Retries a Postgres connect failure once, logged under this name. */
      readonly connectRetryOperation?: string;
    }) => Effect.Effect<
      Option.Option<Client>,
      OAuthStoreUnavailable | ClientMetadataUnavailable
    >;
    /** The request headers a client registered with, such as `x-read-only`. */
    readonly findRegisterHeaders: (input: {
      readonly clientId: string;
    }) => Effect.Effect<
      Option.Option<ClientRegisterHeadersRecord>,
      OAuthStoreUnavailable
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

    findClient: (input: {
      readonly clientId: string;
      readonly connectRetryOperation?: string;
    }) => {
      const lookup = Effect.tryPromise({
        try: async () => model.getClient(input.clientId, ''),
        catch: (cause) =>
          cause instanceof ClientMetadataUnavailableError
            ? ClientMetadataUnavailable.make({ cause })
            : OAuthStoreUnavailable.make({ operation: 'getClient', cause }),
      });

      const attempted =
        input.connectRetryOperation === undefined
          ? lookup
          : lookup.pipe(retryPgConnect(input.connectRetryOperation));

      return attempted.pipe(
        Effect.map(Option.fromUndefinedOr),
        withSpanOkOnClientOutage('OAuthStore.findClient'),
      );
    },

    findRegisterHeaders: ({ clientId }: { readonly clientId: string }) =>
      stored('getClientRegisterHeaders', async () =>
        model.getClientRegisterHeaders(clientId),
      ).pipe(Effect.map(Option.fromUndefinedOr)),

    findAuthorizationCode: ({ code }: { readonly code: string }) =>
      stored('getAuthorizationCode', async () =>
        model.getAuthorizationCode(code),
      ).pipe(
        Effect.map(Option.fromUndefinedOr),
        Effect.withSpan('OAuthStore.findAuthorizationCode'),
      ),

    saveAuthorizationCode: ({ code }: { readonly code: AuthorizationCode }) =>
      stored('saveAuthorizationCode', async () =>
        model.saveAuthorizationCode(code),
      ).pipe(
        retryPgConnect('callback.saveAuthorizationCode'),
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
          clientId: input.token.client.id,
          grantFamilyId: Predicate.isString(saved.grantFamilyId)
            ? saved.grantFamilyId
            : undefined,
        }),
      );

      return saved;
    }),

    findAccessToken: ({ accessToken }: { readonly accessToken: string }) =>
      stored('getStoredAccessToken', async () =>
        model.getStoredAccessToken(accessToken),
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

    revokeToken,
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
