import { Schema } from 'effect';

/**
 * A /callback step failed after the request looked valid. `cause` is the
 * underlying error, which decides the answer. `consumed` says whether the
 * one-time transaction was already used up, so whether a reload can retry.
 * `clientFailure` names a failure that is not the server's (the client's
 * metadata host is down, upstream rejected the code); those stay out of
 * Sentry. `sloEmitted` is set when the step already wrote its SLO line.
 */
export class CallbackFailed extends Schema.TaggedError<
  CallbackFailed,
  { readonly brand: unique symbol }
>()('CallbackFailed', {
  cause: Schema.Unknown,
  clientId: Schema.optional(Schema.String),
  consumed: Schema.Boolean,
  sloEmitted: Schema.Boolean,
  clientFailure: Schema.optional(Schema.String),
}) {
  override get message(): string {
    return 'OAuth callback failed';
  }
}
