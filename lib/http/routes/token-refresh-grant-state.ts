import { GrantRevokedError } from '../../../mcp/oauth/grant-family';
import { GrantStateUnavailableError } from '../../../mcp/oauth/grant-state-error';
import { activeRefreshResponse } from '../../../mcp/oauth/active-refresh-family';
import { Cause, Effect, ErrorReporter } from 'effect';
import { HttpServerResponse } from 'effect/http';
import { emitRefreshSlo } from '../../../mcp/oauth/refresh-slo';
import type { OAuthStoreUnavailable } from '../../../mcp/oauth/oauth-store-unavailable';
import type { RefreshTokenResult } from '../../../mcp/oauth/refresh-token-result';
import { oauthErrorResponse } from '../oauth-error-response';
import type { Grant } from './token-refresh-lock';

export const checkedBody = (result: RefreshTokenResult, grant: Grant) =>
  activeRefreshResponse(result, grant.client.id).pipe(
    Effect.map((body) => HttpServerResponse.jsonUnsafe(body)),
  );

export const answerGrantStateFailure = (
  failure: OAuthStoreUnavailable,
  grant: Grant,
) => {
  const denied = failure.cause instanceof GrantRevokedError;

  const grantStateFailure =
    failure.cause instanceof GrantStateUnavailableError ||
    ['checkRefreshResponse', 'activeRefreshFamily', 'retireLatePair'].includes(
      failure.operation,
    );

  if (!denied && !grantStateFailure) {
    return Effect.fail(failure);
  }

  const outcome = denied ? 'correct_invalid_grant' : 'transient_revocation';

  return emitRefreshSlo({
    outcome,
    startMs: grant.startMs,
    clientId: grant.client.id,
    reason: denied ? 'grant_revoked' : 'grant_state_unavailable',
  }).pipe(
    Effect.andThen(
      denied ? Effect.void : ErrorReporter.report(Cause.fail(failure)),
    ),
    Effect.andThen(Effect.annotateCurrentSpan({ 'error.type': outcome })),
    Effect.as(
      denied
        ? oauthErrorResponse(
            400,
            'invalid_grant',
            'Authorization grant was revoked',
          )
        : oauthErrorResponse(
            503,
            'temporarily_unavailable',
            'OAuth grant state is temporarily unavailable; please retry',
          ),
    ),
  );
};
