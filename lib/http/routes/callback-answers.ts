import { Cause, Effect, ErrorReporter, Option } from 'effect';
import { AUTH_RESTART_DESCRIPTION } from '../../../mcp/oauth/consent-html-headers';
import { FlowAnswer } from '../../../mcp/oauth/flow-answer';
import { emitAuthCallbackSlo } from '../../oauth/auth-callback-slo';
import { UpstreamRefreshTokenMissing } from '../../oauth/upstream-refresh-token-missing';
import { CallbackFailed } from './callback-failed';

export const oauthError = (input: {
  readonly error: string;
  readonly description: string | undefined;
  readonly status?: number;
}) =>
  FlowAnswer.OAuthError({
    status: input.status ?? 400,
    error: input.error,
    description: input.description,
    headers: {},
    context: Option.none(),
  });

export const restartAnswer = () =>
  oauthError({
    error: 'invalid_request',
    description: AUTH_RESTART_DESCRIPTION,
  });

export const isPresent = (value: string | null): value is string =>
  value !== null && value !== '';

export const hostOf = (uri: string): string | undefined => {
  try {
    return new URL(uri).hostname;
  } catch {
    return undefined;
  }
};

/** A server-side failure of a step, with what the answer needs to know. */
export const failed =
  (input: {
    readonly clientId: string | undefined;
    readonly consumed: boolean;
  }) =>
  (error: { readonly cause: unknown }) =>
    CallbackFailed.make({
      cause: error.cause,
      clientId: input.clientId,
      consumed: input.consumed,
      sloEmitted: false,
    });

/** Upstream must issue a refresh token; without one there is nothing to keep. */
export const missingRefreshToken = Effect.fnUntraced(function* (input: {
  readonly startedAt: number;
  readonly clientId: string;
  readonly scope: string | undefined;
}) {
  yield* Effect.logError(
    'Upstream did not issue refresh_token at callback; offline_access likely missing from granted scopes',
  ).pipe(Effect.annotateLogs({ clientId: input.clientId, scope: input.scope }));
  yield* ErrorReporter.report(Cause.fail(UpstreamRefreshTokenMissing.make({})));
  yield* Effect.annotateCurrentSpan({
    'error.type': 'UpstreamRefreshTokenMissing',
  });
  yield* emitAuthCallbackSlo({
    outcome: 'internal_error',
    startedAt: input.startedAt,
    context: { clientId: input.clientId, reason: 'no_refresh_token' },
  });

  return FlowAnswer.OAuthError({
    status: 502,
    error: 'server_error',
    description: 'Upstream did not issue a refresh token',
    headers: {},
    context: Option.none(),
  });
});
