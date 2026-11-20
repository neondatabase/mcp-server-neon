import { Cause, Clock, Effect, ErrorReporter, Layer } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/http';
import { presentToBrowser } from '../../../mcp/oauth/auth-complete-response';
import { emitAuthCallbackSlo } from '../../oauth/auth-callback-slo';
import { oauthBrowserRequest } from '../oauth-request';
import { isPresent, oauthError } from './callback-answers';
import { codeExchange } from './callback-code';
import { CallbackFailed } from './callback-failed';
import { failedAnswer } from './callback-failure';
import { relayUpstreamError } from './callback-relay';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const callbackAnswer = Effect.fnUntraced(function* (startedAt: number) {
  const browser = yield* oauthBrowserRequest;
  const query = browser.url.searchParams;
  const upstreamError = query.get('error');

  if (isPresent(upstreamError)) {
    return yield* relayUpstreamError({
      startedAt,
      query,
      error: upstreamError,
    });
  }

  const code = query.get('code');
  const state = query.get('state');

  if (!isPresent(code) || !isPresent(state)) {
    // A bare GET (direct navigation, prefetch, history), not an upstream
    // failure: its own bucket, outside the SLO denominator.
    yield* Effect.logWarning(
      'Callback hit without code/state and without upstream error',
    ).pipe(
      Effect.annotateLogs({
        hasCode: isPresent(code),
        hasState: isPresent(state),
        queryKeys: [...query.keys()],
      }),
    );
    yield* emitAuthCallbackSlo({ outcome: 'bad_request', startedAt });

    return oauthError({
      error: 'invalid_request',
      description: 'Missing code or state',
    });
  }

  return yield* codeExchange({ startedAt, state });
});

/**
 * GET /callback: the upstream authorization server returns here. Caller
 * mistakes, upstream rejections, and the client's own outages are answered
 * inside the span; server failures fail the span and reach Sentry once.
 */
const callback = Effect.gen(function* () {
  const startedAt = yield* Clock.currentTimeMillis;

  const answer = yield* callbackAnswer(startedAt).pipe(
    Effect.catchDefect((cause) =>
      Effect.fail(
        CallbackFailed.make({ cause, consumed: true, sloEmitted: false }),
      ),
    ),
    Effect.catchTag('CallbackFailed', (failure) =>
      failure.clientFailure === undefined
        ? Effect.fail(failure)
        : Effect.annotateCurrentSpan({
            'error.type': failure.clientFailure,
          }).pipe(Effect.andThen(failedAnswer({ failure, startedAt }))),
    ),
    Effect.withSpan('OAuthCallback.callback'),
    Effect.catchTag('CallbackFailed', (failure) =>
      ErrorReporter.report(Cause.fail(failure)).pipe(
        Effect.andThen(failedAnswer({ failure, startedAt })),
      ),
    ),
  );

  const browser = yield* oauthBrowserRequest;

  return yield* presentToBrowser({
    answer,
    accept: browser.accept,
    query: browser.url.searchParams,
  });
});

export const CallbackRoutes = Layer.mergeAll(
  HttpRouter.add('GET', '/callback', callback),
  HttpRouter.add(
    'OPTIONS',
    '/callback',
    Effect.succeed(
      HttpServerResponse.empty({ status: 204, headers: CORS_HEADERS }),
    ),
  ),
);
