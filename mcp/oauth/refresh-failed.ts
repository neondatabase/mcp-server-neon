import { Effect, ErrorReporter, Result, Schema } from 'effect';
import { HttpServerRespondable } from 'effect/http';
import { oauthErrorResponse } from '../../lib/http/oauth-error-response';
import type { OAuthStoreUnavailable } from './oauth-store-unavailable';
import { SloOutcome } from './refresh-slo';

const RefreshReplay = Schema.Struct({
  ageMs: Schema.Finite,
  next: Schema.Literals(['live', 'rotated', 'gone']),
  reason: Schema.optional(Schema.Literal('revoked')),
});

/**
 * A refresh grant ended with an OAuth error answer, `outcome` being its SLO
 * bucket. Only a failure after upstream rotated the token (a
 * `transient_persist_failure`) is the server's and reaches Sentry; the rest
 * are the token's state or an upstream outage.
 */
export class RefreshFailed extends Schema.TaggedError<
  RefreshFailed,
  { readonly brand: unique symbol }
>()('RefreshFailed', {
  outcome: SloOutcome,
  status: Schema.Finite,
  error: Schema.String,
  description: Schema.String,
  /** Upstream's OAuth error code, so the SLO line can classify a cliff. */
  upstreamOauthError: Schema.optional(Schema.String),
  replay: Schema.optional(RefreshReplay),
  cause: Schema.optional(Schema.Unknown),
}) {
  override get message(): string {
    return this.description;
  }

  get serverFault(): boolean {
    return this.outcome === 'transient_persist_failure';
  }

  get [ErrorReporter.ignore](): boolean {
    return !this.serverFault;
  }

  [HttpServerRespondable.symbol]() {
    return Effect.succeed(
      oauthErrorResponse(this.status, this.error, this.description),
    );
  }
}

/** How the lock holder's refresh can fail. */
export type RefreshError = RefreshFailed | OAuthStoreUnavailable;

/**
 * `Effect.withSpan` that keeps the span ok when the refresh ends with an
 * expected answer, setting `error.type` to its outcome. A server fault still
 * fails the span. The failure reaches the caller either way.
 */
export const withRefreshSpan =
  (name: string) =>
  <A, R>(self: Effect.Effect<A, RefreshError, R>) =>
    self.pipe(
      Effect.map(Result.succeed),
      Effect.catchTag('RefreshFailed', (failure) =>
        failure.serverFault
          ? Effect.fail(failure)
          : Effect.annotateCurrentSpan({ 'error.type': failure.outcome }).pipe(
              Effect.as(Result.fail(failure)),
            ),
      ),
      Effect.withSpan(name),
      Effect.flatMap(Effect.fromResult),
    );

/** The answer for a refresh token we know is dead or not this client's. */
export const invalidRefreshGrant = (
  replay?: typeof RefreshReplay.Type,
): RefreshFailed =>
  RefreshFailed.make({
    outcome: 'correct_invalid_grant',
    status: 400,
    error: 'invalid_grant',
    description: 'Invalid or expired refresh token',
    replay,
  });
