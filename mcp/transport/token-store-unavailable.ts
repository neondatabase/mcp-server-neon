import { Schema } from 'effect';

const RETRY_AFTER_SECONDS = '5';

/**
 * The OAuth token store could not be read and Neon says the bearer is an OAuth
 * token. A 401 would send the client back through refresh for a token that may
 * still be valid, so the request is answered with 503.
 */
export class TokenStoreUnavailable extends Schema.TaggedError<
  TokenStoreUnavailable,
  { readonly brand: unique symbol }
>()('TokenStoreUnavailable', {}) {}

export const tokenStoreUnavailableResponse = (): Response =>
  Response.json(
    { error: 'Token store unavailable', code: 'token_store_unavailable' },
    { status: 503, headers: { 'Retry-After': RETRY_AFTER_SECONDS } },
  );
