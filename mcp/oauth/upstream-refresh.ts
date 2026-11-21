import { Duration, Effect, Predicate, Result, Schema } from 'effect';
import type { UpstreamRequestSummary } from '../../lib/oauth/client';
import { extractUpstreamErrorDetails } from '../../lib/oauth/upstream-error';
import { UpstreamOAuth } from '../../lib/oauth/upstream-oauth';
import type { UpstreamOAuthFailed } from '../../lib/oauth/upstream-oauth-failed';
import { retryLogged } from './logged-retry';
import { UpstreamTimeoutError } from './upstream-timeout-error';

// Cap each upstream refresh attempt. Production data: healthy success p99
// is ~700ms; problematic upstream is bimodal — fast (<200ms) or slow
// (4.5s–37s) — because Hydra holds connections open during 5xx bursts.
// Capping at 4.5s forces a slow response into the 5xx code path before
// waiters exhaust their ~8s lock-poll budget, so the lock release writes
// the transient marker (atomic Lua) and waiters bail fast as
// transient_upstream_5xx (excluded from SLO) instead of cascading into
// transient_lock_timeout (counts BAD).
const UPSTREAM_REFRESH_TIMEOUT_MS = 4500;

// Network-layer error codes commonly observed talking to Hydra. Walking
// the error chain catches openid-client's wrapping (TypeError "fetch failed"
// with .cause containing the underlying Node error).
const RETRYABLE_NETWORK_CODES = [
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_SOCKET',
] as const;

// Capped depth avoids pathological cause cycles.
const networkErrorCode = (error: Error, depth: number): string | undefined => {
  if (depth >= 8) {
    return undefined;
  }

  const code = Predicate.hasProperty(error, 'code') ? error.code : undefined;

  const byCode = Predicate.isString(code)
    ? RETRYABLE_NETWORK_CODES.find((candidate) => candidate === code)
    : undefined;

  return (
    byCode ??
    RETRYABLE_NETWORK_CODES.find((candidate) =>
      error.message.includes(candidate),
    ) ??
    (error.cause instanceof Error
      ? networkErrorCode(error.cause, depth + 1)
      : undefined)
  );
};

type UpstreamRefreshFailure = UpstreamOAuthFailed | UpstreamTimeoutError;

/** The error the attempt surfaced, as the upstream failure log describes it. */
const surfaced = (failure: UpstreamRefreshFailure): Error | undefined => {
  if (Schema.is(UpstreamTimeoutError)(failure)) {
    return failure;
  }

  return failure.cause instanceof Error ? failure.cause : undefined;
};

/** The network-layer error code of a failure that got no HTTP response. */
export const networkFailureCode = (
  failure: UpstreamRefreshFailure,
): string | undefined => {
  const error = surfaced(failure);

  return error === undefined ? undefined : networkErrorCode(error, 0);
};

/**
 * Only failures with NO HTTP response are retried: network-layer failures
 * (DNS, TCP reset). An HTTP 4xx/5xx means Hydra processed the request and
 * possibly rotated the RT; retrying could present an already-rotated token
 * and trigger a cliff. A timeout is never retried either: when we cancel the
 * call we don't know whether Hydra ignored us, returned 5xx, or rotated and
 * we never saw the response.
 */
const retryable = (failure: UpstreamRefreshFailure): boolean => {
  if (Schema.is(UpstreamTimeoutError)(failure)) {
    return false;
  }

  const { cause } = failure;

  if (!(cause instanceof Error)) {
    return false;
  }

  if (
    Predicate.hasProperty(cause, 'status') &&
    Predicate.isNumber(cause.status)
  ) {
    return false;
  }

  return networkErrorCode(cause, 0) !== undefined;
};

const upstreamDetails = (failure: UpstreamRefreshFailure) =>
  Schema.is(UpstreamTimeoutError)(failure)
    ? extractUpstreamErrorDetails(failure)
    : failure.details;

const logUpstreamFailure = (input: {
  readonly failure: UpstreamRefreshFailure;
  readonly clientId: string;
  readonly upstreamRequest: UpstreamRequestSummary | undefined;
}) => {
  const details = upstreamDetails(input.failure);

  return Effect.logError('Upstream refresh token exchange failed').pipe(
    Effect.annotateLogs({
      ...details,
      clientId: input.clientId,
      isClientError:
        details.status !== undefined &&
        details.status >= 400 &&
        details.status < 500,
      networkErrorCode: networkFailureCode(input.failure),
      // Sanitized fingerprint of the HTTP request body we sent upstream.
      // Critical for diagnosing the `invalid_request` cliff_upstream
      // sub-bucket (~50% of all cliffs as of 2026-05-12) where Hydra
      // rejects the call without us being able to tell why from the
      // response alone. See ai-notes/cliff-upstream-investigation.md.
      // Never contains the refresh_token or client_secret values — only
      // a length + 6-char prefix fingerprint for the RT.
      upstreamRequest: input.upstreamRequest,
    }),
  );
};

// Each attempt is cut off after 4.5 s; interrupting one aborts its request.
const timedAttempt = (input: {
  readonly refreshToken: string;
  readonly onRequest: (summary: UpstreamRequestSummary) => void;
}) =>
  UpstreamOAuth.pipe(
    Effect.flatMap((upstream) => upstream.exchangeRefreshToken(input)),
    Effect.timeoutOrElse({
      duration: Duration.millis(UPSTREAM_REFRESH_TIMEOUT_MS),
      orElse: () =>
        Effect.fail(
          UpstreamTimeoutError.make({ timeoutMs: UPSTREAM_REFRESH_TIMEOUT_MS }),
        ),
    }),
  );

/**
 * Forwards the stored refresh token to Hydra: two attempts 200 ms apart for
 * failures without an HTTP response, each cut off after 4.5 s. A failure is
 * logged with a sanitized summary of the request that was sent; a 4xx keeps
 * the span ok.
 */
export const exchangeRefreshTokenUpstream = (input: {
  readonly refreshToken: string;
  readonly clientId: string;
}) =>
  Effect.gen(function* () {
    // openid-client reports each request it sends; a retry overwrites the
    // first, so the last one written is what surfaced.
    let upstreamRequest: UpstreamRequestSummary | undefined = undefined;

    yield* Effect.logInfo('Exchanging refresh token with upstream');

    const tokens = yield* retryLogged({
      attempt: timedAttempt({
        refreshToken: input.refreshToken,
        onRequest: (summary) => {
          upstreamRequest = summary;
        },
      }),
      op: 'upstream refresh exchange',
      delaysMs: [200],
      retryable,
      describe: (failure) => surfaced(failure)?.message ?? failure.message,
    }).pipe(
      Effect.tapError((failure) =>
        logUpstreamFailure({
          failure,
          clientId: input.clientId,
          upstreamRequest,
        }),
      ),
    );

    yield* Effect.logInfo('Upstream token exchange successful');

    return tokens;
  }).pipe(
    Effect.map(Result.succeed),
    Effect.catchTag('UpstreamOAuthFailed', (failure) =>
      failure.rejected
        ? Effect.annotateCurrentSpan({
            'error.type': 'UpstreamOAuthRejected',
          }).pipe(Effect.as(Result.fail(failure)))
        : Effect.fail(failure),
    ),
    Effect.withSpan('RefreshToken.exchangeUpstream'),
    Effect.flatMap(Effect.fromResult),
  );
