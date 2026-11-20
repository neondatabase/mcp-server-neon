import { Effect, Option } from 'effect';
import type { Client } from 'oauth2-server';
import type { DownstreamAuthRequest } from '../../../mcp/oauth/downstream-auth-request';
import {
  matchesRedirectUri,
  normalizeRedirectUris,
} from '../../oauth/redirect-uri';
import { oauthErrorResponse } from '../oauth-error-response';

const rejected = (input: {
  readonly log: Effect.Effect<void>;
  readonly error: string;
  readonly description: string;
}) =>
  input.log.pipe(
    Effect.as(
      Option.some(oauthErrorResponse(400, input.error, input.description)),
    ),
  );

const supportsResponseType = (client: Client, responseType: string) => {
  const supported: unknown = client.response_types;

  return Array.isArray(supported) && supported.includes(responseType);
};

/**
 * Why the client can't use this authorization request, if it can't: no stored
 * redirect URIs, an unsupported response type, or an unregistered redirect.
 */
export const clientRejection = (input: {
  readonly request: DownstreamAuthRequest;
  readonly client: Client;
}) => {
  const { request, client } = input;
  const { clientId } = request;
  const registered = normalizeRedirectUris(client.redirect_uris);

  if (registered === undefined) {
    return rejected({
      log: Effect.logWarning('Invalid stored redirect URIs').pipe(
        Effect.annotateLogs({ clientId }),
      ),
      error: 'invalid_client',
      description: 'Invalid redirect URI metadata',
    });
  }

  if (!supportsResponseType(client, request.responseType)) {
    return rejected({
      log: Effect.logWarning('Invalid response type').pipe(
        Effect.annotateLogs({
          clientId,
          providedResponseType: request.responseType,
          supportedResponseTypes: client.response_types,
        }),
      ),
      error: 'unsupported_response_type',
      description: 'Invalid response type',
    });
  }

  if (!matchesRedirectUri(request.redirectUri, registered)) {
    return rejected({
      log: Effect.logWarning('Invalid redirect URI').pipe(
        Effect.annotateLogs({
          clientId,
          providedRedirectUri: request.redirectUri,
          registeredRedirectUris: registered,
        }),
      ),
      error: 'invalid_request',
      description: 'Invalid redirect URI',
    });
  }

  return Effect.succeedNone;
};
