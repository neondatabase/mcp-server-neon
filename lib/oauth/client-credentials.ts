import { Effect } from 'effect';
import type { Client } from 'oauth2-server';
import {
  clientIdFromAssertion,
  verifyClientAssertion,
} from './client-assertion';
import {
  ClientMetadataUnavailableError,
  isClientIdMetadataUrl,
} from './client-id-metadata-document';
import { ClientMetadataUnavailable } from './client-metadata-unavailable';
import { OAuthServerFault } from './oauth-server-fault';

type ClientCredentials = {
  clientId: string | undefined;
  clientSecret: string | undefined;
  clientAssertion: string | undefined;
  clientAssertionType: string | undefined;
};

export function extractClientCredentials(
  authorization: string | null | undefined,
  formData: URLSearchParams,
): ClientCredentials {
  const clientAssertion = formData.get('client_assertion') ?? undefined;
  const clientAssertionType =
    formData.get('client_assertion_type') ?? undefined;
  if (authorization?.startsWith('Basic ')) {
    const credentials = atob(authorization.replace(/^Basic\s+/i, ''));
    const [clientId, clientSecret] = credentials.split(':');
    return { clientId, clientSecret, clientAssertion, clientAssertionType };
  }

  return {
    clientId:
      formData.get('client_id') ??
      (clientAssertion ? clientIdFromAssertion(clientAssertion) : undefined),
    clientSecret: formData.get('client_secret') ?? undefined,
    clientAssertion,
    clientAssertionType,
  };
}

/**
 * Authenticates the client with the method it registered or declared. A
 * metadata-document client that declares `private_key_jwt` has no secret, so
 * only an assertion authenticates it. A registered client always received a
 * secret, and one that registered `private_key_jwt` could only ever
 * authenticate with that secret, so it still can.
 */
export async function authenticateClient(
  client: Client,
  credentials: ClientCredentials,
): Promise<boolean> {
  if (client.tokenEndpointAuthMethod === 'none') return true;
  if (
    client.tokenEndpointAuthMethod === 'private_key_jwt' &&
    (isClientIdMetadataUrl(client.id) || credentials.clientAssertion)
  ) {
    return verifyClientAssertion(
      client,
      credentials.clientAssertion,
      credentials.clientAssertionType,
    );
  }
  return credentials.clientSecret === client.secret;
}

/**
 * `authenticateClient` for Effect code. A metadata document or JWKS that can't
 * be read right now fails with `ClientMetadataUnavailable`.
 */
export const verifyClientCredentials = (
  client: Client,
  credentials: ClientCredentials,
) =>
  Effect.tryPromise({
    try: async () => authenticateClient(client, credentials),
    catch: (error) =>
      error instanceof ClientMetadataUnavailableError
        ? ClientMetadataUnavailable.make({ cause: error })
        : OAuthServerFault.make({
            endpoint: 'client authentication',
            cause: error,
          }),
  }).pipe(Effect.withSpan('OAuthClient.authenticate'));
