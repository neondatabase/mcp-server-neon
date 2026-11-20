import { Effect, Schema } from 'effect';
import { HttpServerRespondable } from 'effect/http';
import { oauthServerErrorResponse } from '../../lib/oauth/oauth-server-fault';

/**
 * The OAuth store could not be read or written. It escapes the route, so
 * Sentry gets it and the client gets the OAuth `server_error` 500.
 */
export class OAuthStoreUnavailable extends Schema.TaggedError<
  OAuthStoreUnavailable,
  { readonly brand: unique symbol }
>()('OAuthStoreUnavailable', {
  operation: Schema.String,
  cause: Schema.Unknown,
}) {
  override get message(): string {
    return `OAuth store ${this.operation} failed`;
  }

  [HttpServerRespondable.symbol]() {
    return Effect.succeed(oauthServerErrorResponse());
  }
}
