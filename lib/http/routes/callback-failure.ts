import { Effect, Option } from 'effect';
import { FlowAnswer } from '../../../mcp/oauth/flow-answer';
import { isPgConnectFailure } from '../../../mcp/oauth/kv-store';
import { emitAuthCallbackSlo } from '../../oauth/auth-callback-slo';
import { oauthErrorAnswer } from '../../oauth/oauth-error';
import type { CallbackFailed } from './callback-failed';

// A coarse fingerprint for the SLO line, so a Postgres compute hiccup can be
// told apart from a generic exception without grepping messages.
const failureReason = (cause: Error) => {
  if (isPgConnectFailure(cause)) {
    return 'pg_connect_failure';
  }

  return cause.name === '' ? 'unknown' : cause.name;
};

/**
 * The answer to a failed step: the SLO line unless the step wrote one, and a
 * page a reload can retry while the transaction is unused.
 */
export const failedAnswer = Effect.fnUntraced(function* (input: {
  readonly failure: CallbackFailed;
  readonly startedAt: number;
}) {
  const { failure, startedAt } = input;

  const cause =
    failure.cause instanceof Error
      ? failure.cause
      : new Error(String(failure.cause));

  if (!failure.sloEmitted) {
    yield* emitAuthCallbackSlo({
      outcome: 'internal_error',
      startedAt,
      context: { clientId: failure.clientId, reason: failureReason(cause) },
    });
  }

  yield* Effect.logError('OAuth callback error:').pipe(
    Effect.annotateLogs({ message: cause.message, error: cause }),
  );

  const answer = oauthErrorAnswer(cause);
  const retryable = !failure.consumed && answer.status >= 500;

  return FlowAnswer.OAuthError({
    status: answer.status,
    error: answer.error,
    description: answer.description,
    headers: answer.headers ?? {},
    context: retryable ? Option.some({ retryable: true }) : Option.none(),
  });
});
