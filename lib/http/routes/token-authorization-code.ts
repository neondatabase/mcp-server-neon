import { Clock, Effect, Option, Predicate, Schema } from 'effect';
import { HttpServerResponse } from 'effect/http';
import type { AuthorizationCode, Client, Token } from 'oauth2-server';
import { Analytics } from '../../../mcp/analytics/analytics-service';
import { OAuthStore } from '../../../mcp/oauth/oauth-store';
import { toSeconds } from '../../../mcp/oauth/refresh-token-result';
import { UpstreamRefreshTokenMissing } from '../../oauth/upstream-refresh-token-missing';
import {
  codeRejection,
  isPresent,
  rejected,
  storedFault,
} from './token-code-checks';

const IssuedTokens = Schema.Struct({
  token: Schema.Struct({
    access_token: Schema.String,
    access_token_expires_at: Schema.Finite,
    refresh_token: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  grant: Schema.optional(Schema.Unknown),
});

const CodeUser = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.optional(Schema.String),
  isOrg: Schema.optional(Schema.Boolean),
});

// Logged as the record holds it, or not at all.
const userIdOf = (code: AuthorizationCode) => {
  const user: unknown = code.user;

  return Predicate.hasProperty(user, 'id') ? user.id : undefined;
};

const identifyUser = Effect.fnUntraced(function* (input: {
  readonly client: Client;
  readonly user: typeof CodeUser.Type;
}) {
  const { user } = input;
  const analytics = yield* Analytics;
  const clientName: unknown = input.client.client_name;

  yield* analytics.identify({
    account: {
      id: user.id,
      name: user.name,
      email: user.email,
      isOrg: user.isOrg ?? false,
    },
    params: {
      context: {
        authMethod: 'oauth',
        client: { id: input.client.id, name: clientName },
      },
    },
  });
});

const tokenResponse = (input: {
  readonly token: Token;
  readonly code: AuthorizationCode;
}) =>
  Clock.currentTimeMillis.pipe(
    Effect.map((now) => {
      const expiresAt: unknown = input.token.expires_at;

      return HttpServerResponse.jsonUnsafe({
        access_token: input.token.accessToken,
        expires_in: toSeconds(Number(expiresAt) - now),
        token_type: 'bearer',
        refresh_token: input.token.refreshToken,
        scope: input.code.scope,
      });
    }),
  );

/** Issues the code's upstream tokens to `client` and consumes the code. */
const issueTokens = Effect.fnUntraced(function* (input: {
  readonly client: Client;
  readonly code: AuthorizationCode;
}) {
  const { client, code } = input;

  const issued =
    yield* Schema.decodeUnknownEffect(IssuedTokens)(code).pipe(storedFault);

  // Decoded before any write, so a malformed code saves nothing.
  const user = yield* Schema.decodeUnknownEffect(CodeUser)(code.user).pipe(
    storedFault,
  );

  const upstreamRefreshToken = issued.token.refresh_token;

  if (!isPresent(upstreamRefreshToken)) {
    yield* Effect.logError(
      'Authorization code missing refresh_token; upstream did not issue one',
    ).pipe(
      Effect.annotateLogs({ clientId: client.id, userId: userIdOf(code) }),
    );

    return yield* UpstreamRefreshTokenMissing.make({});
  }

  const store = yield* OAuthStore;

  yield* Effect.logInfo('Saving token for authorization_code grant');

  const token = yield* store.saveTokenPair({
    token: {
      accessToken: issued.token.access_token,
      refreshToken: upstreamRefreshToken,
      expires_at: issued.token.access_token_expires_at,
      client,
      user: code.user,
      scope: code.scope,
      grant: issued.grant,
    },
    refreshToken: upstreamRefreshToken,
  });

  yield* identifyUser({ client, user });
  // An authorization code can only be used once.
  yield* store.consumeAuthorizationCode({ code });
  yield* Effect.logInfo('Authorization code exchanged successfully');

  return yield* tokenResponse({ token, code });
});

/** The authorization_code grant for an authenticated client. */
export const authorizationCodeGrant = Effect.fnUntraced(function* (input: {
  readonly formData: URLSearchParams;
  readonly client: Client;
}) {
  const { formData, client } = input;

  yield* Effect.logInfo('Processing authorization_code grant');

  const codeParam = formData.get('code');

  if (!isPresent(codeParam)) {
    yield* Effect.logWarning('Authorization code missing');

    return yield* rejected(400, 'invalid_request', 'code is required');
  }

  const store = yield* OAuthStore;
  const found = yield* store.findAuthorizationCode({ code: codeParam });

  if (Option.isNone(found)) {
    yield* Effect.logWarning('Invalid authorization code');

    return yield* rejected(400, 'invalid_grant', 'Invalid authorization code');
  }

  const code = found.value;

  yield* Effect.logInfo('Authorization code found').pipe(
    Effect.annotateLogs({ userId: userIdOf(code) }),
  );

  const rejection = yield* codeRejection({ formData, client, code });

  if (Option.isSome(rejection)) {
    return rejection.value;
  }

  return yield* issueTokens({ client, code });
});
