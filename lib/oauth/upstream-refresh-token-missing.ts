import { Effect, Schema } from 'effect';
import { HttpServerRespondable } from 'effect/http';
import { oauthErrorResponse } from '../http/oauth-error-response';

/**
 * The authorization code holds no upstream refresh token, so the client
 * could never refresh what it would be issued. Sentry gets it and the client
 * gets 502.
 */
export class UpstreamRefreshTokenMissing extends Schema.TaggedError<
  UpstreamRefreshTokenMissing,
  { readonly brand: unique symbol }
>()('UpstreamRefreshTokenMissing', {}) {
  override get message(): string {
    return 'Upstream did not issue a refresh token';
  }

  [HttpServerRespondable.symbol]() {
    return Effect.succeed(
      oauthErrorResponse(502, 'server_error', this.message),
    );
  }
}
