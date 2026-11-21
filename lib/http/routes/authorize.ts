import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/http';
import { clientMetadataUnavailableResponse } from '../../oauth/client-metadata-unavailable';
import { OAuthServerFault } from '../../oauth/oauth-server-fault';
import { oauthErrorResponse } from '../oauth-error-response';
import { AUTHORIZE_CORS_HEADERS } from './authorize-consent';
import { authorizeGet } from './authorize-get';
import { authorizePost } from './authorize-post';

// Caller mistakes and the client's own outages are answered inside the span;
// a store or upstream failure, or anything unexpected, escapes it, so Sentry
// gets it once and the client gets the OAuth error it always did.
const get = authorizeGet.pipe(
  Effect.catchTags({
    InvalidRequestOrigin: () =>
      Effect.annotateCurrentSpan({ 'error.type': 'InvalidRequestOrigin' }).pipe(
        Effect.as(
          oauthErrorResponse(400, 'invalid_request', 'Invalid request origin'),
        ),
      ),
    ClientMetadataUnavailable: () =>
      Effect.annotateCurrentSpan({
        'error.type': 'ClientMetadataUnavailable',
      }).pipe(Effect.as(clientMetadataUnavailableResponse())),
  }),
  Effect.catchDefect((cause) =>
    Effect.fail(OAuthServerFault.make({ endpoint: 'authorize', cause })),
  ),
  Effect.tapError((error) =>
    Effect.logError('Authorization error:').pipe(
      Effect.annotateLogs({ message: error.message }),
    ),
  ),
  Effect.withSpan('OAuthAuthorize.consent'),
);

const post = authorizePost.pipe(
  Effect.catchTags({
    ClientMetadataUnavailable: () =>
      Effect.annotateCurrentSpan({
        'error.type': 'ClientMetadataUnavailable',
      }).pipe(Effect.as(clientMetadataUnavailableResponse())),
  }),
  Effect.catchDefect((cause) =>
    Effect.fail(OAuthServerFault.make({ endpoint: 'authorize', cause })),
  ),
  Effect.tapError((error) =>
    Effect.logError('Authorization error:').pipe(
      Effect.annotateLogs({ message: error.message }),
    ),
  ),
  Effect.withSpan('OAuthAuthorize.approve'),
);

export const AuthorizeRoutes = Layer.mergeAll(
  HttpRouter.add('GET', '/api/authorize', get),
  HttpRouter.add('POST', '/api/authorize', post),
  HttpRouter.add(
    'OPTIONS',
    '/api/authorize',
    Effect.succeed(
      HttpServerResponse.empty({
        status: 204,
        headers: AUTHORIZE_CORS_HEADERS,
      }),
    ),
  ),
);
