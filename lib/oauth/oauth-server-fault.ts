import { Effect, Schema } from 'effect';
import { HttpServerRespondable, HttpServerResponse } from 'effect/http';

/** The OAuth `server_error` answer for a failure that is the server's. */
export const oauthServerErrorResponse = () =>
  HttpServerResponse.jsonUnsafe(
    { error: 'server_error', error_description: 'Internal server error' },
    { status: 500 },
  );

/**
 * An OAuth endpoint threw where nothing expected it to. Sentry gets it and the
 * client gets `server_error`, as for any other server failure.
 */
export class OAuthServerFault extends Schema.TaggedError<
  OAuthServerFault,
  { readonly brand: unique symbol }
>()('OAuthServerFault', { endpoint: Schema.String, cause: Schema.Unknown }) {
  override get message(): string {
    return `OAuth ${this.endpoint} failed unexpectedly`;
  }

  [HttpServerRespondable.symbol]() {
    return Effect.succeed(oauthServerErrorResponse());
  }
}
