import { Cause, Effect, ErrorReporter, Option } from 'effect';
import { AuthTransactions } from '../../../mcp/oauth/auth-transactions';
import { clientNameForPage } from '../../../mcp/oauth/auth-complete-response';
import { isAuthTransactionId } from '../../../mcp/oauth/browser-binding';
import type { DownstreamAuthRequest } from '../../../mcp/oauth/downstream-auth-request';
import { FlowAnswer } from '../../../mcp/oauth/flow-answer';
import { SERVER_HOST } from '../../config';
import {
  classifyUpstreamError,
  emitAuthCallbackSlo,
  summarizeDownstreamRequest,
} from '../../oauth/auth-callback-slo';
import { oauthBrowserRequest } from '../oauth-request';
import { hostOf, isPresent, oauthError } from './callback-answers';

/**
 * RFC 6749 §4.1.2.1: the error redirect to the downstream client, so the MCP
 * client sees the failure on its own side instead of leaving the user on our
 * /callback page.
 */
const clientErrorRedirect = (input: {
  readonly request: DownstreamAuthRequest;
  readonly error: string;
  readonly description: string | null;
  readonly uri: string | null;
}) => {
  const url = new URL(input.request.redirectUri);

  url.searchParams.set('error', input.error);

  if (isPresent(input.description)) {
    url.searchParams.set('error_description', input.description);
  }

  if (isPresent(input.uri)) {
    url.searchParams.set('error_uri', input.uri);
  }

  if (input.request.state !== '') {
    url.searchParams.set('state', input.request.state);
  }

  url.searchParams.set('iss', SERVER_HOST);

  return url;
};

const relayedErrorAnswer = (error: string, description: string | null) =>
  oauthError({
    error,
    description: description ?? 'Upstream authorization failed',
  });

/** Consumes the transaction a relayed upstream error belongs to. */
const consumeForRelay = Effect.fnUntraced(function* (state: string) {
  const browser = yield* oauthBrowserRequest;

  const browserSecret = isAuthTransactionId(state)
    ? browser.browserSecret(state)
    : undefined;

  if (browserSecret === undefined) {
    return Option.none();
  }

  const transactions = yield* AuthTransactions;

  // An unreadable store is answered like a transaction we can't find, as it
  // always was; the failure is the server's, so Sentry gets it.
  return yield* transactions.consumeBound({ id: state, browserSecret }).pipe(
    Effect.catchTag('OAuthStoreUnavailable', (failure) =>
      ErrorReporter.report(Cause.fail(failure)).pipe(
        Effect.andThen(
          Effect.annotateCurrentSpan({
            'error.type': 'OAuthStoreUnavailable',
          }),
        ),
        Effect.as(Option.none()),
      ),
    ),
  );
});

type Relay = {
  readonly startedAt: number;
  readonly error: string;
  readonly description: string | null;
  readonly uri: string | null;
};

/** No transaction this browser is bound to: answer the error ourselves. */
const unboundRelay = Effect.fnUntraced(function* (input: {
  readonly startedAt: number;
  readonly error: string;
  readonly description: string | null;
}) {
  const { startedAt, error, description } = input;

  yield* Effect.logWarning(
    'Failed to decode state while relaying upstream error',
  ).pipe(
    Effect.annotateLogs({
      upstreamError: error,
      decodeErr: 'invalid authorization transaction',
    }),
  );
  yield* emitAuthCallbackSlo({
    outcome: 'state_decode_failed',
    startedAt,
    context: {
      upstreamError: error,
      reason: 'decode_failed_during_error_relay',
    },
  });

  return relayedErrorAnswer(error, description);
});

/** Relays the error to a client whose transaction this browser is bound to. */
const relayToClient = Effect.fnUntraced(function* (
  relay: Relay & { readonly state: string },
) {
  const { startedAt, error, description, uri, state } = relay;
  const bound = yield* consumeForRelay(state);

  if (Option.isNone(bound)) {
    return yield* unboundRelay({ startedAt, error, description });
  }

  const { request } = bound.value;

  // Re-classified with the decoded redirect_uri host, so the ChatGPT bucket
  // can fire; the pre-decode classification could not know the host.
  yield* emitAuthCallbackSlo({
    outcome: classifyUpstreamError({
      error,
      description,
      status: undefined,
      redirectUriHost: hostOf(request.redirectUri),
    }),
    startedAt,
    context: {
      clientId: request.clientId,
      upstreamError: error,
      downstreamRequest: summarizeDownstreamRequest({ state, request }),
    },
  });

  const clientName = yield* clientNameForPage(request);
  const browser = yield* oauthBrowserRequest;

  return FlowAnswer.Redirect({
    location: clientErrorRedirect({ request, error, description, uri }).href,
    status: 307,
    clears: Option.some({ id: state, secure: browser.secure }),
    context: Option.some({
      clientId: request.clientId,
      clientName,
      relayedError: error,
    }),
  });
});

/** Upstream redirected back with `?error=`: relay it to the client. */
export const relayUpstreamError = Effect.fnUntraced(function* (input: {
  readonly startedAt: number;
  readonly query: URLSearchParams;
  readonly error: string;
}) {
  const { startedAt, query, error } = input;
  const description = query.get('error_description');
  const uri = query.get('error_uri');
  const state = query.get('state');

  const outcome = classifyUpstreamError({
    error,
    description,
    status: undefined,
  });

  yield* Effect.logWarning('Upstream returned error to /callback').pipe(
    Effect.annotateLogs({
      upstreamError: error,
      upstreamErrorDescription: description,
      upstreamErrorUri: uri,
      hasState: isPresent(state),
      outcome,
    }),
  );

  if (!isPresent(state)) {
    yield* emitAuthCallbackSlo({
      outcome,
      startedAt,
      context: { upstreamError: error, reason: 'no_state_for_relay' },
    });

    return relayedErrorAnswer(error, description);
  }

  return yield* relayToClient({ startedAt, error, description, uri, state });
});
