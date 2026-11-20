import { Effect, Option } from 'effect';
import { isAuthTransactionId } from '../../../mcp/oauth/browser-binding';
import { emitAuthCallbackSlo } from '../../oauth/auth-callback-slo';
import { clientIdForSpan } from '../../oauth/client-id-span';
import { oauthBrowserRequest } from '../oauth-request';
import { oauthError, restartAnswer } from './callback-answers';
import {
  consumeApprovedTransaction,
  exchangeUpstreamCode,
} from './callback-exchange';
import { issueAuthorizationCode } from './callback-issue';

// Upstream checks the redirect URI it issued the code for, which is https.
const withHttps = (url: URL) => {
  const https = new URL(url);

  https.protocol = 'https:';

  return https;
};

/** The browser binding for `state`, or none with the SLO line written. */
const boundState = Effect.fnUntraced(function* (input: {
  readonly startedAt: number;
  readonly state: string;
}) {
  const { startedAt, state } = input;

  if (!isAuthTransactionId(state)) {
    yield* Effect.logError('Failed to decode state at /callback').pipe(
      Effect.annotateLogs({ reason: 'unsigned_or_malformed_state' }),
    );
    yield* emitAuthCallbackSlo({ outcome: 'state_decode_failed', startedAt });

    return Option.none();
  }

  const browser = yield* oauthBrowserRequest;
  const browserSecret = browser.browserSecret(state);

  if (browserSecret === undefined) {
    yield* emitAuthCallbackSlo({
      outcome: 'state_decode_failed',
      startedAt,
      context: { reason: 'missing_browser_binding' },
    });

    return Option.none();
  }

  return Option.some(browserSecret);
});

const unknownClient = Effect.fnUntraced(function* (input: {
  readonly startedAt: number;
  readonly clientId: string;
}) {
  const { startedAt, clientId } = input;

  yield* Effect.logWarning('Client not found at /callback').pipe(
    Effect.annotateLogs({ clientId }),
  );
  yield* emitAuthCallbackSlo({
    outcome: 'internal_error',
    startedAt,
    context: { clientId, reason: 'client_not_found' },
  });

  return oauthError({
    error: 'invalid_client',
    description: 'Invalid client ID',
  });
});

/** The approved transaction this browser is bound to, consumed. */
const boundTransaction = Effect.fnUntraced(function* (input: {
  readonly startedAt: number;
  readonly state: string;
}) {
  const browserSecret = yield* boundState(input);

  if (Option.isNone(browserSecret)) {
    return Option.none();
  }

  return yield* consumeApprovedTransaction({
    ...input,
    browserSecret: browserSecret.value,
  });
});

/** `?code=&state=` from upstream: exchange it and issue our own code. */
export const codeExchange = Effect.fnUntraced(function* (input: {
  readonly startedAt: number;
  readonly state: string;
}) {
  const { startedAt, state } = input;
  const consumed = yield* boundTransaction(input);

  if (Option.isNone(consumed)) {
    return restartAnswer();
  }

  const { client, approved } = consumed.value;
  const { clientId } = approved.request;
  const browser = yield* oauthBrowserRequest;
  const currentUrl = withHttps(browser.url);

  // The exchange runs before the client check: the upstream code is
  // single-use either way, and an exchange failure is classified first.
  const tokens = yield* exchangeUpstreamCode({
    startedAt,
    state,
    currentUrl,
    request: approved.request,
  });

  if (Option.isNone(client)) {
    return yield* unknownClient({ startedAt, clientId });
  }

  yield* Effect.annotateCurrentSpan({
    'oauth.client_id': clientIdForSpan(clientId),
  });

  return yield* issueAuthorizationCode({
    startedAt,
    state,
    client: client.value,
    approved,
    tokens,
  });
});
