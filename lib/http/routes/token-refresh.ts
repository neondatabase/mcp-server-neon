import { Cause, Clock, Effect, ErrorReporter, Option } from 'effect';
import type { RefreshResult } from '../../../mcp/oauth/kv-store';
import type { RefreshFailed } from '../../../mcp/oauth/refresh-failed';
import { RefreshRotations } from '../../../mcp/oauth/refresh-rotations';
import { emitRefreshSlo, loggedReplay } from '../../../mcp/oauth/refresh-slo';
import type { SloOutcome } from '../../../mcp/oauth/refresh-slo';
import { cachedToResponse } from '../../../mcp/oauth/refresh-token-result';
import type { RefreshTokenResult } from '../../../mcp/oauth/refresh-token-result';
import { logFallbacksOnce } from '../../../mcp/oauth/store-fallback';
import { oauthErrorResponse } from '../oauth-error-response';
import {
  checkSuccessCache,
  refreshUnderLock,
  rejectedReplay,
  servedPair,
} from './token-refresh-lock';
import {
  checkedBody,
  answerGrantStateFailure,
} from './token-refresh-grant-state';
import type { Grant } from './token-refresh-lock';

const answered = (outcome: SloOutcome) =>
  Effect.annotateCurrentSpan({ 'error.type': outcome });

const servedOverFailure = Effect.fnUntraced(function* (input: {
  readonly grant: Grant;
  readonly cached: RefreshResult;
}) {
  const { grant } = input;
  const now = yield* Clock.currentTimeMillis;

  const response = yield* checkedBody(
    cachedToResponse({ cached: input.cached, now }),
    grant,
  );

  yield* emitRefreshSlo({
    outcome: 'success',
    startMs: grant.startMs,
    clientId: grant.client.id,
    reason: 'cache_replay_over_failure',
  });

  return Option.some(response);
});

// Absorbs retry storms: a token upstream already rejected recently skips the
// lock and the upstream call and gets the cached failure.
const answerFromFailureCache = Effect.fnUntraced(function* (grant: Grant) {
  const { client, startMs } = grant;
  const rotations = yield* RefreshRotations;
  const failure = yield* rotations.cachedFailure(grant);

  if (Option.isNone(failure)) {
    return Option.none();
  }

  const owned = yield* rotations.attributedOutcome(grant);
  const now = yield* Clock.currentTimeMillis;
  const served = servedPair(owned);

  if (Option.isSome(served)) {
    return yield* servedOverFailure({ grant, cached: served.value });
  }

  yield* Effect.logInfo('Refresh token in failure cache; rejecting fast').pipe(
    Effect.annotateLogs({
      clientId: client.id,
      ageMs: now - failure.value.failedAt,
      oauthError: failure.value.oauthError,
    }),
  );
  yield* emitRefreshSlo({
    outcome: 'correct_invalid_grant',
    startMs,
    clientId: client.id,
    reason: 'failure_cache_hit',
    upstreamOauthError: failure.value.oauthError,
    replay: loggedReplay(rejectedReplay(owned), client),
  });
  yield* answered('correct_invalid_grant');

  return Option.some(
    oauthErrorResponse(
      400,
      'invalid_grant',
      'Invalid or expired refresh token',
    ),
  );
});

const refreshAnswered = Effect.fnUntraced(function* (grant: Grant) {
  const result = yield* refreshUnderLock(grant);
  const response = yield* checkedBody(result, grant);

  yield* Effect.logInfo('Returning refresh token response');
  yield* emitRefreshSlo({
    outcome: 'success',
    startMs: grant.startMs,
    clientId: grant.client.id,
  });

  return response;
});

// A winning peer's cached result is folded into this answer. That also
// covers a failed persist: the success cache is written before the persist,
// so the client gets a clean 200 instead of a 500 and an immediate cliff.
/** Another attempt already rotated this grant: serve its cached result. */
const answerFromCache = Effect.fnUntraced(function* (input: {
  readonly grant: Grant;
  readonly failure: RefreshFailed;
  readonly cached: RefreshTokenResult;
}) {
  const { grant, failure, cached } = input;
  const response = yield* checkedBody(cached, grant);

  // A recovered persist failure still counts as bad in the SLO, so the
  // metric doesn't mask Postgres degradation behind a 200.
  const recovered = failure.outcome === 'transient_persist_failure';

  const sloBucket: SloOutcome = recovered
    ? 'transient_persist_failure'
    : 'success';

  // The client is served, but the server failed to persist the rotation.
  if (recovered) {
    yield* ErrorReporter.report(Cause.fail(failure));
    yield* Effect.annotateCurrentSpan({ 'error.type': 'RefreshFailed' });
  }

  yield* Effect.logInfo(
    'Returning cached refresh result (cross-instance hit)',
  ).pipe(
    Effect.annotateLogs({ sloBucket, underlyingOutcome: failure.outcome }),
  );
  yield* emitRefreshSlo({
    outcome: sloBucket,
    startMs: grant.startMs,
    clientId: grant.client.id,
    reason: recovered ? 'recovered_via_cache' : 'cache_replay_after_error',
  });

  return response;
});

const answerRefreshFailure = Effect.fnUntraced(function* (input: {
  readonly grant: Grant;
  readonly failure: RefreshFailed;
}) {
  const { grant, failure } = input;
  const { client, startMs } = grant;
  const cached = yield* checkSuccessCache(grant);

  if (Option.isSome(cached)) {
    return yield* answerFromCache({ grant, failure, cached: cached.value });
  }

  yield* emitRefreshSlo({
    outcome: failure.outcome,
    startMs,
    clientId: client.id,
    upstreamOauthError: failure.upstreamOauthError,
    replay: loggedReplay(failure.replay, client),
  });

  // The server's failure escapes, so Sentry gets it once; it answers itself.
  if (failure.serverFault) {
    return yield* failure;
  }

  yield* answered(failure.outcome);

  return oauthErrorResponse(failure.status, failure.error, failure.description);
});

const answerLockTimeout = Effect.fnUntraced(function* (grant: Grant) {
  yield* Effect.logInfo(
    'Refresh lock waiter timed out; returning 503 for retry',
  );
  yield* emitRefreshSlo({
    outcome: 'transient_lock_timeout',
    startMs: grant.startMs,
    clientId: grant.client.id,
  });
  yield* answered('transient_lock_timeout');

  return oauthErrorResponse(
    503,
    'temporarily_unavailable',
    'A refresh of this token is in progress; please retry shortly',
  );
});

/** The refresh_token grant for an authenticated client. */
export const refreshTokenGrant = Effect.fnUntraced(function* (input: {
  readonly formData: URLSearchParams;
  readonly client: Grant['client'];
}) {
  const { formData, client } = input;

  yield* Effect.logInfo('Processing refresh_token grant');

  const startMs = yield* Clock.currentTimeMillis;
  const refreshToken = formData.get('refresh_token');

  if (refreshToken === null || refreshToken === '') {
    yield* Effect.logWarning('Refresh token missing from request');
    yield* emitRefreshSlo({
      outcome: 'bad_request',
      startMs,
      clientId: client.id,
      reason: 'missing_refresh_token',
    });
    yield* answered('bad_request');

    return oauthErrorResponse(
      400,
      'invalid_request',
      'refresh_token is required',
    );
  }

  const grant = { refreshToken, client, startMs };

  return yield* Effect.gen(function* () {
    const fast = yield* answerFromFailureCache(grant);

    if (Option.isSome(fast)) {
      return fast.value;
    }

    return yield* refreshAnswered(grant).pipe(
      Effect.catchTags({
        RefreshFailed: (failure) => answerRefreshFailure({ grant, failure }),
        RefreshLockTimeout: () => answerLockTimeout(grant),
      }),
    );
  }).pipe(
    Effect.catchTag('OAuthStoreUnavailable', (failure) =>
      answerGrantStateFailure(failure, grant),
    ),
  );
}, logFallbacksOnce);
