import { Effect, Option, Result } from 'effect';
import type { DownstreamAuthRequest } from '../../../mcp/oauth/downstream-auth-request';
import { HttpServerResponse } from 'effect/http';
import { OAuthStore } from '../../../mcp/oauth/oauth-store';
import { clientIdForSpan } from '../../oauth/client-id-span';
import { oauthErrorResponse } from '../oauth-error-response';
import { oauthBrowserRequest } from '../oauth-request';
import { clientRejection } from './authorize-client';
import { renderConsent } from './authorize-render';
import {
  canonicalLocation,
  parseAuthRequest,
  readOnlyPreference,
  resourceGrantOf,
} from './authorize-request';

/**
 * The client this request may use and its read-only default, or the answer
 * that rejects the request.
 */
const validatedClient = Effect.fnUntraced(function* (input: {
  readonly request: DownstreamAuthRequest;
  readonly searchParams: URLSearchParams;
}) {
  const { request, searchParams } = input;
  const store = yield* OAuthStore;
  const client = yield* store.findClient({ clientId: request.clientId });

  yield* Effect.logInfo('Authorize request').pipe(
    Effect.annotateLogs({
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      responseType: request.responseType,
      scope: request.scope,
    }),
  );

  const readOnly = yield* readOnlyPreference({
    clientId: request.clientId,
    searchParams,
  });

  if (Option.isNone(client)) {
    yield* Effect.logWarning('Client not found').pipe(
      Effect.annotateLogs({ clientId: request.clientId }),
    );

    return Result.fail(
      oauthErrorResponse(400, 'invalid_client', 'Invalid client ID'),
    );
  }

  const rejection = yield* clientRejection({ request, client: client.value });

  if (Option.isSome(rejection)) {
    return Result.fail(rejection.value);
  }

  yield* Effect.annotateCurrentSpan({
    'oauth.client_id': clientIdForSpan(request.clientId),
  });

  return Result.succeed({ client: client.value, readOnly });
});

/** GET /api/authorize: validates the request and renders consent. */
export const authorizeGet = Effect.gen(function* () {
  const browser = yield* oauthBrowserRequest;
  // The raw URL: Next.js's `nextUrl` rewrites a loopback redirect_uri.
  const { url } = browser;
  const canonical = yield* canonicalLocation(url);

  if (canonical !== undefined) {
    return HttpServerResponse.redirect(canonical, { status: 302 });
  }

  const request = parseAuthRequest(url.searchParams);
  const resourceGrant = yield* resourceGrantOf(request.resource);

  if (Option.isNone(resourceGrant)) {
    return oauthErrorResponse(
      400,
      'invalid_target',
      'Invalid resource parameter',
    );
  }

  const validated = yield* validatedClient({
    request,
    searchParams: url.searchParams,
  });

  return yield* Result.match(validated, {
    onFailure: Effect.succeed,
    onSuccess: ({ client, readOnly }) =>
      renderConsent({
        request,
        client,
        resourceGrant: resourceGrant.value,
        readOnly,
      }),
  });
});
