import { Clock, Effect, Layer, Option, Schema } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';
import type { Client } from 'oauth2-server';
import { OAuthStore } from '../../../mcp/oauth/oauth-store';
import { generateRandomString } from '../../../mcp/oauth/utils';
import { OAuthServerFault } from '../../oauth/oauth-server-fault';
import { normalizeRedirectUris } from '../../oauth/redirect-uri';
import {
  oauthErrorResponse,
  unreadableBodyResponse,
} from '../oauth-error-response';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-read-only',
};

/** The registration request is malformed; answered 400 with `description`. */
class InvalidRegistration extends Schema.TaggedError<
  InvalidRegistration,
  { readonly brand: unique symbol }
>()('InvalidRegistration', {
  reason: Schema.String,
  description: Schema.String,
}) {}

const JsonBody = Schema.fromJsonString(Schema.Json);

const RegistrationPayload = Schema.Record(Schema.String, Schema.Json);

type RegistrationPayload = typeof RegistrationPayload.Type;

const GrantTypes = Schema.Array(
  Schema.Literals(['authorization_code', 'refresh_token']),
);

const ResponseTypes = Schema.Array(Schema.Literals(['code']));

const invalid = (reason: string, description: string) =>
  InvalidRegistration.make({ reason, description });

const decodePayload = Effect.fnUntraced(function* (body: string) {
  const json = Schema.decodeOption(JsonBody)(body);

  if (Option.isNone(json)) {
    return yield* invalid('invalid_json', 'Invalid JSON in request body');
  }

  const payload = Schema.decodeUnknownOption(RegistrationPayload)(
    json.value,
  ).pipe(Option.getOrElse((): RegistrationPayload => ({})));

  yield* Effect.logInfo('request to register client').pipe(
    Effect.annotateLogs({
      name: payload.client_name,
      client_uri: payload.client_uri,
    }),
  );

  return payload;
});

// Checked in this order, so a request with several problems is told the first.
const parseRegistration = Effect.fnUntraced(function* (body: string) {
  const payload = yield* decodePayload(body);

  if (payload.client_name === undefined) {
    return yield* invalid('client_name_missing', 'client_name is required');
  }

  const redirectUris = normalizeRedirectUris(payload.redirect_uris);

  if (redirectUris === undefined) {
    return yield* invalid('redirect_uris_missing', 'redirect_uris is required');
  }

  const grantTypes = Schema.decodeUnknownOption(GrantTypes)(
    payload.grant_types,
  );

  if (Option.isNone(grantTypes)) {
    return yield* invalid(
      'grant_types_invalid',
      'grant_types is required and must only include supported grant types',
    );
  }

  if (!Schema.is(ResponseTypes)(payload.response_types)) {
    return yield* invalid(
      'response_types_invalid',
      'response_types is required and must only include supported response types',
    );
  }

  return { payload, redirectUris, grantTypes: grantTypes.value };
});

const lowercaseHeaders = (headers: Readonly<Record<string, string>>) =>
  Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );

const logRegistered = Effect.fnUntraced(function* (input: {
  readonly client: Client;
  readonly payload: RegistrationPayload;
}) {
  const { client, payload } = input;
  const clientId: string = client.id;

  yield* Effect.logInfo('new client registered').pipe(
    Effect.annotateLogs({
      clientId,
      client_name: payload.client_name,
      redirect_uris: client.redirect_uris,
      client_uri: payload.client_uri,
    }),
  );

  yield* Effect.logInfo('returning registration response').pipe(
    Effect.annotateLogs({
      clientId,
      tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
    }),
  );
});

const registration = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const body = yield* request.text;
  const { payload, redirectUris, grantTypes } = yield* parseRegistration(body);

  const now = yield* Clock.currentTimeMillis;
  const clientId = generateRandomString(8);
  const clientSecret = generateRandomString(32);

  const tokenEndpointAuthMethod =
    payload.token_endpoint_auth_method ?? 'client_secret_post';

  // The stored client keeps every field the client sent.
  const client: Client = {
    ...payload,
    redirect_uris: redirectUris,
    grants: [...grantTypes],
    id: clientId,
    secret: clientSecret,
    tokenEndpointAuthMethod,
    registrationDate: Math.floor(now / 1000),
  };

  const store = yield* OAuthStore;

  yield* store.saveClient({
    client,
    registerHeaders: lowercaseHeaders(request.headers),
  });

  yield* logRegistered({ client, payload });

  return HttpServerResponse.jsonUnsafe({
    client_id: clientId,
    client_secret: clientSecret,
    client_name: payload.client_name,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: tokenEndpointAuthMethod,
  });
});

/**
 * POST /api/register (RFC 7591 dynamic client registration). A malformed
 * request is answered inside the span; a store failure or anything unexpected
 * is the server's and reaches Sentry.
 */
const register = registration.pipe(
  Effect.catchTags({
    InvalidRegistration: ({ reason, description }) =>
      Effect.logWarning('Client registration validation failed').pipe(
        Effect.annotateLogs({ reason }),
        Effect.andThen(
          Effect.annotateCurrentSpan({ 'error.type': 'InvalidRegistration' }),
        ),
        Effect.as(oauthErrorResponse(400, 'invalid_request', description)),
      ),
    HttpServerError: unreadableBodyResponse,
  }),
  Effect.catchDefect((cause) =>
    Effect.fail(OAuthServerFault.make({ endpoint: 'register', cause })),
  ),
  Effect.tapError((error) =>
    Effect.logError('Client registration error:').pipe(
      Effect.annotateLogs({ message: error.message, error: error.cause }),
    ),
  ),
  Effect.withSpan('OAuthRegister.register'),
);

export const RegisterRoutes = Layer.mergeAll(
  HttpRouter.add('POST', '/api/register', register),
  HttpRouter.add(
    'OPTIONS',
    '/api/register',
    Effect.succeed(
      HttpServerResponse.empty({ status: 204, headers: CORS_HEADERS }),
    ),
  ),
);
