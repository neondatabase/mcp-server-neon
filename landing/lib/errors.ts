import { NextResponse } from 'next/server';
import { logger } from '../mcp-src/utils/logger';

type OAuthErrorResponse = {
  error: string;
  error_description?: string;
};

/**
 * Handles errors from OAuth flows and returns appropriate HTTP responses.
 * - ResponseBodyError (openid-client) with 4xx → 400
 * - ResponseBodyError with 5xx → 502 (bad gateway)
 * - Network errors → 502 (upstream unavailable)
 * - JSON parse errors → 400 (bad request)
 * - Other errors → 500 (internal server error)
 */
export function handleOAuthError(
  error: unknown,
  context: string,
): NextResponse<OAuthErrorResponse> {
  const message = error instanceof Error ? error.message : 'Unknown error';
  logger.error(`${context}:`, { message, error });

  // ResponseBodyError from openid-client (upstream OAuth errors)
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code: string }).code === 'RESPONSE_BODY_ERROR'
  ) {
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
