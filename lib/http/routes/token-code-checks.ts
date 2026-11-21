import { Clock, Effect, Option, Schema } from 'effect';
import type { AuthorizationCode, Client } from 'oauth2-server';
import { verifyPKCE } from '../../../mcp/oauth/utils';
import { OAuthServerFault } from '../../oauth/oauth-server-fault';
import { oauthErrorResponse } from '../oauth-error-response';

// What /callback stores on an authorization code besides the library's
// fields, each decoded where the exchange first reads it. The rest are
// decoded in token-authorization-code.ts.
const CodeChallenge = Schema.Struct({
  code_challenge: Schema.optional(Schema.NullOr(Schema.String)),
  code_challenge_method: Schema.optional(Schema.NullOr(Schema.String)),
});

const RedirectUris = Schema.Array(Schema.String);

// A stored record that doesn't have the shape /callback and /api/register
// write is the server's failure.
export const storedFault = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  self.pipe(
    Effect.mapError((cause) =>
      OAuthServerFault.make({ endpoint: 'token', cause }),
    ),
  );

export const isPresent = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value !== '';

export const rejected = (status: number, error: string, description: string) =>
  Effect.annotateCurrentSpan({ 'error.type': error }).pipe(
    Effect.as(oauthErrorResponse(status, error, description)),
  );

const rejectedSome = (status: number, error: string, description: string) =>
  rejected(status, error, description).pipe(Effect.asSome);

const redirectRejection = Effect.fnUntraced(function* (input: {
  readonly formData: URLSearchParams;
  readonly client: Client;
  readonly code: AuthorizationCode;
  readonly isPkceEnabled: boolean;
}) {
  const { client, code } = input;
  const redirectUri = input.formData.get('redirect_uri');

  if (!input.isPkceEnabled && !isPresent(redirectUri)) {
    yield* Effect.logWarning('Missing redirect_uri for non-PKCE flow');

    return yield* rejectedSome(
      400,
      'invalid_request',
      'redirect_uri is required when not using PKCE',
    );
  }

  if (!isPresent(redirectUri) || redirectUri === code.redirectUri) {
    return Option.none();
  }

  // A loopback redirect authorizes on any port (RFC 8252), so the
  // URI bound to the code can differ from every registered string.
  const registered = yield* Schema.decodeUnknownEffect(RedirectUris)(
    client.redirect_uris,
  ).pipe(storedFault);

  if (registered.includes(redirectUri)) {
    return Option.none();
  }

  yield* Effect.logWarning('Invalid redirect_uri').pipe(
    Effect.annotateLogs({ provided: redirectUri }),
  );

  return yield* rejectedSome(400, 'invalid_request', 'Invalid redirect URI');
});

const pkceCheck = Effect.fnUntraced(function* (input: {
  readonly formData: URLSearchParams;
  readonly code: AuthorizationCode;
}) {
  const challenge = yield* Schema.decodeUnknownEffect(CodeChallenge)(
    input.code,
  ).pipe(storedFault);

  const isPkceEnabled = challenge.code_challenge !== undefined;
  const codeVerifier = input.formData.get('code_verifier');

  if (
    isPkceEnabled &&
    !verifyPKCE(
      challenge.code_challenge ?? '',
      challenge.code_challenge_method ?? '',
      codeVerifier ?? '',
    )
  ) {
    yield* Effect.logWarning('Invalid PKCE code verifier');

    return {
      isPkceEnabled,
      rejection: yield* rejectedSome(
        400,
        'invalid_grant',
        'Invalid PKCE code verifier',
      ),
    };
  }

  return { isPkceEnabled, rejection: Option.none() };
});

/** Why `code` can't be exchanged by `client`, checked in this order. */
export const codeRejection = Effect.fnUntraced(function* (input: {
  readonly formData: URLSearchParams;
  readonly client: Client;
  readonly code: AuthorizationCode;
}) {
  const { formData, client, code } = input;

  if (code.client.id !== client.id) {
    yield* Effect.logWarning('Authorization code client mismatch').pipe(
      Effect.annotateLogs({
        codeClientId: code.client.id,
        requestClientId: client.id,
      }),
    );

    return yield* rejectedSome(
      400,
      'invalid_grant',
      'Invalid authorization code',
    );
  }

  const now = yield* Clock.currentTimeMillis;

  if (code.expiresAt < new Date(now)) {
    yield* Effect.logWarning('Authorization code expired');

    return yield* rejectedSome(
      400,
      'invalid_grant',
      'Authorization code expired',
    );
  }

  const pkce = yield* pkceCheck({ formData, code });

  if (Option.isSome(pkce.rejection)) {
    return pkce.rejection;
  }

  return yield* redirectRejection({
    formData,
    client,
    code,
    isPkceEnabled: pkce.isPkceEnabled,
  });
});
