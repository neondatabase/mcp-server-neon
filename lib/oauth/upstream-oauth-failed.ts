import { Effect, ErrorReporter, Schema } from 'effect';
import { HttpServerRespondable } from 'effect/http';
import { oauthErrorAnswer, oauthErrorAnswerResponse } from './oauth-error';
import { extractUpstreamErrorDetails } from './upstream-error';

/**
 * A call to the upstream authorization server failed. A 4xx is the token's or
 * the request's fault and stays out of Sentry; anything else (5xx, a
 * non-conforming response, no response) is reported.
 */
export class UpstreamOAuthFailed extends Schema.TaggedError<
  UpstreamOAuthFailed,
  { readonly brand: unique symbol }
>()('UpstreamOAuthFailed', {
  operation: Schema.String,
  cause: Schema.Unknown,
}) {
  get details() {
    return extractUpstreamErrorDetails(this.cause);
  }

  get rejected(): boolean {
    const { status } = this.details;

    return status !== undefined && status >= 400 && status < 500;
  }

  override get message(): string {
    return `Upstream OAuth ${this.operation} failed`;
  }

  get [ErrorReporter.ignore](): boolean {
    return this.rejected;
  }

  /** The OAuth answer this failure gets when nothing handles it. */
  get answer() {
    const cause =
      this.cause instanceof Error ? this.cause : new Error(String(this.cause));

    return oauthErrorAnswer(cause);
  }

  [HttpServerRespondable.symbol]() {
    return Effect.succeed(oauthErrorAnswerResponse(this.answer));
  }
}
