import { NextResponse } from 'next/server';
import { logger } from '../mcp-src/utils/logger';
import { extractUpstreamErrorDetails } from './oauth/upstream-error';

type OAuthErrorResponse = {
  error: string;
  error_description?: string;
};

// oauth4webapi error code constants. Importing them directly via the
// `openid-client` re-exports isn't tree-shakeable for the bundle; the
// string values are stable per the library's public API.
const OAUTH_RESPONSE_BODY_ERROR = 'OAUTH_RESPONSE_BODY_ERROR';
const OAUTH_RESPONSE_IS_NOT_CONFORM = 'OAUTH_RESPONSE_IS_NOT_CONFORM';

/**
 * Handles errors from OAuth flows and returns appropriate HTTP responses.
 * - ResponseBodyError (openid-client OAUTH_RESPONSE_BODY_ERROR, conforming
 *   OAuth error body): 4xx → 400, 5xx → 502
 * - OperationProcessingError with OAUTH_RESPONSE_IS_NOT_CONFORM (upstream
 *   returned an unexpected HTTP status / non-OAuth body) → 502, surfacing
 *   the underlying upstream HTTP status when available.
 * - Network errors → 502 (upstream unavailable)
 * - JSON parse errors → 400 (bad request)
 * - Other errors → 500 (internal server error)
 *
 * Constant-name bug history: this code originally compared against
 * 'RESPONSE_BODY_ERROR' but oauth4webapi's actual constant is
 * 'OAUTH_RESPONSE_BODY_ERROR'. The branch silently never fired and every
 * conforming OAuth error from Hydra surfaced as a generic 500 to the
 * browser. Fixed in the same change that adds IS_NOT_CONFORM handling.
 */
export function handleOAuthError(
  error: unknown,
  context: string,
): NextResponse<OAuthErrorResponse> {
  const message = error instanceof Error ? error.message : 'Unknown error';
  const code =
    error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  logger.error(`${context}:`, { message, code, error });

  // ResponseBodyError from openid-client (upstream returned a conforming
  // OAuth error body: status 400 + JSON `{error, error_description}`).
  if (code === OAUTH_RESPONSE_BODY_ERROR) {
    const oauthError = error as {
      error?: string;
      error_description?: string;
      status?: number;
    };
    const upstreamStatus = oauthError.status ?? 500;
    const responseStatus = upstreamStatus >= 500 ? 502 : 400;

    const response = NextResponse.json(
      {
        error: oauthError.error ?? 'upstream_error',
        error_description: oauthError.error_description,
      },
      { status: responseStatus },
    );
    logger.debug('handleOAuthError returning upstream response', {
      context,
      status: response.status,
      error: oauthError.error ?? 'upstream_error',
    });
    return response;
  }

  // OperationProcessingError with OAUTH_RESPONSE_IS_NOT_CONFORM: upstream
  // returned an unexpected HTTP status (e.g. Hydra 500 with a non-JSON
  // body during token-endpoint outages). Walk the attached Response cause
  // to surface the actual upstream status code in logs and the response.
  if (code === OAUTH_RESPONSE_IS_NOT_CONFORM) {
    const details = extractUpstreamErrorDetails(error);
    const response = NextResponse.json(
      {
        error: 'upstream_error',
        error_description: `Upstream returned a non-conforming response${
          details.status ? ` (status=${details.status})` : ''
        }`,
      },
      { status: 502 },
    );
    logger.debug('handleOAuthError returning is-not-conform response', {
      context,
      status: response.status,
      upstreamStatus: details.status,
      upstreamUrl: details.upstreamUrl,
    });
    return response;
  }

  // Network errors
  if (error instanceof TypeError && message.includes('fetch')) {
    const response = NextResponse.json(
      {
        error: 'upstream_unavailable',
        error_description: 'Failed to connect to authorization server',
      },
      { status: 502 },
    );
    logger.debug('handleOAuthError returning network response', {
      context,
      status: response.status,
      error: 'upstream_unavailable',
    });
    return response;
  }

  // JSON parse errors
  if (error instanceof SyntaxError && message.includes('JSON')) {
    const response = NextResponse.json(
      {
        error: 'invalid_request',
        error_description: 'Invalid JSON in request body',
      },
      { status: 400 },
    );
    logger.debug('handleOAuthError returning json-parse response', {
      context,
      status: response.status,
      error: 'invalid_request',
    });
    return response;
  }

  // Internal server errors
  const response = NextResponse.json(
    { error: 'server_error', error_description: 'Internal server error' },
    { status: 500 },
  );
  logger.debug('handleOAuthError returning generic response', {
    context,
    status: response.status,
    error: 'server_error',
  });
  return response;
}
