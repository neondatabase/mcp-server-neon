import { Schema } from 'effect';
import { HttpServerResponse } from 'effect/http';

/**
 * A client ID metadata document, or the JWKS it names, could not be read right
 * now. The client's credentials may be fine, so it is told to retry rather
 * than `invalid_client`, which would make it discard them during its own
 * host's outage.
 */
export class ClientMetadataUnavailable extends Schema.TaggedError<
  ClientMetadataUnavailable,
  { readonly brand: unique symbol }
>()('ClientMetadataUnavailable', { cause: Schema.Unknown }) {}

export const clientMetadataUnavailableResponse = () =>
  HttpServerResponse.jsonUnsafe(
    {
      error: 'temporarily_unavailable',
      error_description: 'Could not read the client ID metadata document',
    },
    { status: 503, headers: { 'Retry-After': '30' } },
  );
