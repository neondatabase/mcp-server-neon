import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';
import type { Client } from 'oauth2-server';
import { OAuthStore } from '../../../mcp/oauth/oauth-store';
import { clientIdForSpan } from '../../oauth/client-id-span';
import {
  readClientCredentials,
  verifyClientCredentials,
} from '../../oauth/client-credentials';
import { oauthErrorResponse } from '../oauth-error-response';
import { authorizationCodeGrant } from './token-authorization-code';
import {
  answeredInSpan,
  defectAsFault,
  metadataUnavailable,
  serverFailure,
  unreadableBody,
} from './token-errors';
import { refreshTokenGrant } from './token-refresh';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const SUPPORTED_GRANT_TYPES: ReadonlySet<string> = new Set([
  'authorization_code',
  'refresh_token',
]);

const rejected = (status: number, error: string, description: string) =>
  Effect.annotateCurrentSpan({ 'error.type': error }).pipe(
    Effect.as(oauthErrorResponse(status, error, description)),
  );

const invalidClient = () =>
  rejected(
    400,
    'invalid_client',
    'client not found or invalid client credentials',
  );

const grantFor = (input: {
  readonly grantType: string | null;
  readonly formData: URLSearchParams;
  readonly client: Client;
}) => {
  const { grantType, formData, client } = input;

  if (grantType === 'authorization_code') {
    return authorizationCodeGrant({ formData, client });
  }

  if (grantType === 'refresh_token') {
    return refreshTokenGrant({ formData, client });
  }

  return Effect.logWarning('Invalid grant type').pipe(
    Effect.annotateLogs({ grantType }),
    Effect.andThen(
      rejected(400, 'unsupported_grant_type', 'Unsupported grant type'),
    ),
  );
};

const authenticationFailed = (input: {
  readonly clientId: string;
  readonly client: Client;
}) =>
  Effect.logWarning('Client authentication failed').pipe(
    Effect.annotateLogs({
      clientId: input.clientId,
      method: input.client.tokenEndpointAuthMethod,
    }),
    Effect.andThen(invalidClient()),
  );

/** Authenticates the client, then runs the grant the form names. */
const tokenForClient = Effect.fnUntraced(function* (input: {
  readonly formData: URLSearchParams;
  readonly grantType: string | null;
  readonly authorization: string | undefined;
}) {
  const { formData, grantType } = input;

  const credentials = yield* readClientCredentials(
    input.authorization,
    formData,
  );

  const { clientId } = credentials;

  if (clientId === undefined || clientId === '') {
    yield* Effect.logWarning('Token request missing client_id');

    return yield* rejected(400, 'invalid_request', 'client_id is required');
  }

  const store = yield* OAuthStore;
  const client = yield* store.findClient({ clientId });

  if (Option.isNone(client)) {
    yield* Effect.logWarning('Client not found').pipe(
      Effect.annotateLogs({ clientId }),
    );

    return yield* invalidClient();
  }

  yield* Effect.annotateCurrentSpan({
    'oauth.client_id': clientIdForSpan(client.value.id),
  });

  const authenticated = yield* verifyClientCredentials(
    client.value,
    credentials,
  );

  if (!authenticated) {
    return yield* authenticationFailed({ clientId, client: client.value });
  }

  return yield* grantFor({ grantType, formData, client: client.value });
});

const tokenRequest = Effect.gen(function* () {
  yield* Effect.logInfo('Token endpoint called');

  const request = yield* HttpServerRequest.HttpServerRequest;
  const contentType = request.headers['content-type'];

  if (!(contentType?.includes('application/x-www-form-urlencoded') ?? false)) {
    yield* Effect.logWarning('Invalid content type for token request').pipe(
      Effect.annotateLogs({ contentType: contentType ?? null }),
    );

    return yield* rejected(415, 'invalid_request', 'Invalid content type');
  }

  const body = yield* request.text;
  const formData = new URLSearchParams(body);
  const grantType = formData.get('grant_type');

  // Only the grant types this endpoint knows, so a caller can't put
  // arbitrary text on the span.
  if (grantType !== null) {
    yield* Effect.annotateCurrentSpan({
      'oauth.grant_type': SUPPORTED_GRANT_TYPES.has(grantType)
        ? grantType
        : 'unsupported',
    });
  }

  yield* Effect.logInfo('Token request parsed').pipe(
    Effect.annotateLogs({ grantType }),
  );

  return yield* tokenForClient({
    formData,
    grantType,
    authorization: request.headers.authorization,
  });
});

/**
 * POST /api/token (RFC 6749): the authorization_code and refresh_token
 * grants. A request the client got wrong is answered inside the span; a store
 * failure or anything unexpected is the server's and reaches Sentry.
 */
const token = tokenRequest.pipe(
  Effect.catchTags({
    ClientMetadataUnavailable: metadataUnavailable,
    HttpServerError: unreadableBody,
    MalformedClientCredentials: (malformed) =>
      answeredInSpan(malformed, 'MalformedClientCredentials'),
  }),
  defectAsFault,
  Effect.withSpan('OAuthToken.token'),
  Effect.catchTags({
    OAuthStoreUnavailable: serverFailure,
    OAuthServerFault: serverFailure,
  }),
);

export const TokenRoutes = Layer.mergeAll(
  HttpRouter.add('POST', '/api/token', token),
  HttpRouter.add(
    'OPTIONS',
    '/api/token',
    Effect.succeed(
      HttpServerResponse.empty({ status: 204, headers: CORS_HEADERS }),
    ),
  ),
);
