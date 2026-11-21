import { Effect, Option } from 'effect';
import type { Client } from 'oauth2-server';
import { AuthTransactions } from '../../../mcp/oauth/auth-transactions';
import type { DownstreamAuthRequest } from '../../../mcp/oauth/downstream-auth-request';
import { OAuthStore } from '../../../mcp/oauth/oauth-store';
import {
  classifyUpstreamError,
  emitAuthCallbackSlo,
  summarizeDownstreamRequest,
} from '../../oauth/auth-callback-slo';
import { UpstreamOAuth } from '../../oauth/upstream-oauth';
import type { UpstreamOAuthFailed } from '../../oauth/upstream-oauth-failed';
import { failed, hostOf } from './callback-answers';
import { CallbackFailed } from './callback-failed';

/** The stored client for a transaction that is not consumed yet. */
const findPendingClient = (clientId: string) =>
  Effect.gen(function* () {
    const store = yield* OAuthStore;

    return yield* store.findClient({
      clientId,
      connectRetryOperation: 'callback.getClient',
    });
  }).pipe(
    Effect.catchTags({
      OAuthStoreUnavailable: (error) =>
        Effect.fail(failed({ clientId, consumed: false })(error)),
      ClientMetadataUnavailable: ({ cause }) =>
        Effect.fail(
          CallbackFailed.make({
            cause,
            clientId,
            consumed: false,
            sloEmitted: false,
            clientFailure: 'ClientMetadataUnavailable',
          }),
        ),
    }),
  );

/**
 * The client and the approved transaction, consumed. The client is resolved
 * before the one-use transaction is consumed: a client ID metadata document
 * can be temporarily unreadable, and the browser must be able to retry.
 */
export const consumeApprovedTransaction = Effect.fnUntraced(function* (input: {
  readonly startedAt: number;
  readonly state: string;
  readonly browserSecret: string;
}) {
  const { startedAt, state, browserSecret } = input;
  const transactions = yield* AuthTransactions;

  const pending = yield* transactions
    .getById({ id: state })
    .pipe(Effect.mapError(failed({ clientId: undefined, consumed: false })));

  const pendingClientId = Option.getOrUndefined(
    pending.pipe(Option.map(({ request }) => request.clientId)),
  );

  const client =
    pendingClientId === undefined
      ? Option.none<Client>()
      : yield* findPendingClient(pendingClientId);

  const approved = yield* transactions
    .consumeApproved({ id: state, browserSecret })
    .pipe(
      // A failed consume may not have run its DELETE, so a reload can retry.
      Effect.mapError(failed({ clientId: pendingClientId, consumed: false })),
    );

  if (Option.isNone(approved)) {
    yield* emitAuthCallbackSlo({
      outcome: 'state_decode_failed',
      startedAt,
      context: { reason: 'transaction_not_approved' },
    });

    return Option.none();
  }

  return Option.some({ client, approved: approved.value });
});

/** Logs and classifies a failed exchange, then fails the step. */
const exchangeFailed = Effect.fnUntraced(function* (input: {
  readonly failure: UpstreamOAuthFailed;
  readonly startedAt: number;
  readonly state: string;
  readonly request: DownstreamAuthRequest;
}) {
  const { failure, startedAt, state, request } = input;
  const { details } = failure;

  const outcome = classifyUpstreamError({
    error: details.oauthError ?? '',
    description: details.oauthErrorDescription ?? null,
    status: details.status,
    redirectUriHost: hostOf(request.redirectUri),
  });

  yield* Effect.logError('Upstream code exchange failed at /callback').pipe(
    Effect.annotateLogs({ ...details, clientId: request.clientId, outcome }),
  );
  yield* emitAuthCallbackSlo({
    outcome,
    startedAt,
    context: {
      clientId: request.clientId,
      upstreamError: details.oauthError,
      upstreamStatus: details.status,
      downstreamRequest: summarizeDownstreamRequest({ state, request }),
    },
  });

  return yield* CallbackFailed.make({
    cause: failure.cause,
    clientId: request.clientId,
    consumed: true,
    sloEmitted: true,
    clientFailure: failure.rejected ? 'UpstreamOAuthRejected' : undefined,
  });
});

/** Exchanges the upstream code; a failure writes its own SLO line. */
export const exchangeUpstreamCode = Effect.fnUntraced(function* (input: {
  readonly startedAt: number;
  readonly state: string;
  readonly currentUrl: URL;
  readonly request: DownstreamAuthRequest;
}) {
  const { startedAt, state, currentUrl, request } = input;
  const upstream = yield* UpstreamOAuth;

  return yield* upstream
    .exchangeCode({ currentUrl, state })
    .pipe(
      Effect.catchTag('UpstreamOAuthFailed', (failure) =>
        exchangeFailed({ failure, startedAt, state, request }),
      ),
    );
});
