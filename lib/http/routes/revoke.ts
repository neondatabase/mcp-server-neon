import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { OAuthStore } from '../../../mcp/oauth/oauth-store';
import { clientMetadataUnavailableResponse } from '../../oauth/client-metadata-unavailable';
import {
  readClientCredentials,
  verifyClientCredentials,
} from '../../oauth/client-credentials';
import {
  OAuthServerFault,
  oauthServerErrorResponse,
} from '../../oauth/oauth-server-fault';
import {
  oauthErrorResponse,
  unreadableBodyResponse,
} from '../oauth-error-response';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// RFC 7009: the endpoint answers 200 for an unknown client or token, so a
// caller can't probe for them.
const revoked = HttpServerResponse.empty({ status: 200 });

/** Authenticates the client, then revokes the token it names. */
const revokeForClient = Effect.fnUntraced(function* (
  formData: URLSearchParams,
) {
  const authorization = yield* HttpServerRequest.HttpServerRequest.pipe(
    Effect.map((request) => request.headers.authorization),
  );

  const credentials = yield* readClientCredentials(authorization, formData);

  if (credentials.clientId === undefined || credentials.clientId === '') {
    return oauthErrorResponse(400, 'invalid_request', 'client_id is required');
  }

  const store = yield* OAuthStore;
  const client = yield* store.findClient({ clientId: credentials.clientId });

  if (Option.isNone(client)) {
    return revoked;
  }

  const authenticated = yield* verifyClientCredentials(
    client.value,
    credentials,
  );

  if (!authenticated) {
    return oauthErrorResponse(
      401,
      'invalid_client',
      'Invalid client credentials',
    );
  }

  const token = formData.get('token');

  if (token === null || token === '') {
    return oauthErrorResponse(400, 'invalid_request', 'token is required');
  }

  yield* store.revokeToken({
    token,
    // An empty hint counts as no hint, so both token types are tried.
    tokenTypeHint: Option.fromNullishOr(formData.get('token_type_hint')).pipe(
      Option.filter((hint) => hint !== ''),
    ),
    clientId: client.value.id,
  });

  return revoked;
});

const revocation = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;

  const isForm =
    request.headers['content-type']?.includes(
      'application/x-www-form-urlencoded',
    ) ?? false;

  if (!isForm) {
    return oauthErrorResponse(415, 'invalid_request', 'Invalid content type');
  }

  const body = yield* request.text;

  return yield* revokeForClient(new URLSearchParams(body));
});

/**
 * POST /api/revoke (RFC 7009). An unreadable client metadata document is the
 * client's outage, answered inside the span; a store failure or anything
 * unexpected is the server's and reaches Sentry.
 */
const revoke = revocation.pipe(
  Effect.catchTags({
    ClientMetadataUnavailable: () =>
      Effect.annotateCurrentSpan({
        'error.type': 'ClientMetadataUnavailable',
      }).pipe(Effect.as(clientMetadataUnavailableResponse())),
    HttpServerError: unreadableBodyResponse,
    // It always answered server_error; it is the caller's input, so it stays
    // out of Sentry.
    MalformedClientCredentials: () =>
      Effect.annotateCurrentSpan({
        'error.type': 'MalformedClientCredentials',
      }).pipe(Effect.as(oauthServerErrorResponse())),
  }),
  Effect.catchDefect((cause) =>
    Effect.fail(OAuthServerFault.make({ endpoint: 'revoke', cause })),
  ),
  Effect.tapError((error) =>
    Effect.logError('Token revocation error:').pipe(
      Effect.annotateLogs({ message: error.message, error: error.cause }),
    ),
  ),
  Effect.withSpan('OAuthRevoke.revoke'),
);

export const RevokeRoutes = Layer.mergeAll(
  HttpRouter.add('POST', '/api/revoke', revoke),
  HttpRouter.add(
    'OPTIONS',
    '/api/revoke',
    Effect.succeed(
      HttpServerResponse.empty({ status: 204, headers: CORS_HEADERS }),
    ),
  ),
);
