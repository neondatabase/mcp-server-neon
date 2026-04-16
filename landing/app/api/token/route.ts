import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { Client } from 'oauth2-server';
import { model } from '../../../mcp-src/oauth/model';
import { exchangeRefreshToken } from '../../../lib/oauth/client';
import { verifyPKCE } from '../../../mcp-src/oauth/utils';
import { identify, flushAnalytics } from '../../../mcp-src/analytics/analytics';
import { handleOAuthError } from '../../../lib/errors';
import { logger } from '../../../mcp-src/utils/logger';
import { singleflight } from '../../../mcp-src/utils/singleflight';

const toSeconds = (ms: number): number => Math.floor(ms / 1000);
const toMilliseconds = (seconds: number): number => seconds * 1000;

type RefreshTokenResult = {
  access_token: string;
  expires_in: number;
  token_type: 'bearer';
  refresh_token: string;
  scope?: string | string[];
};

class RefreshError extends Error {
  constructor(
    public readonly oauthError: string,
    public readonly description: string,
    public readonly statusCode: number,
  ) {
    super(description);
    this.name = 'RefreshError';
  }
}

async function executeRefresh(
  refreshToken: string,
  client: Client,
): Promise<RefreshTokenResult> {
  const providedRefreshToken = await model.getRefreshToken(refreshToken);
  if (!providedRefreshToken) {
    logger.warn('Refresh token not found in storage');
    throw new RefreshError(
      'invalid_grant',
      'Invalid or expired refresh token',
      400,
    );
  }

  const oldToken = await model.getAccessToken(providedRefreshToken.accessToken);
  if (!oldToken) {
    logger.warn('Access token for refresh token not found, cleaning up');
    await model.deleteRefreshToken(providedRefreshToken);
    throw new RefreshError(
      'invalid_grant',
      'Invalid or expired refresh token',
      400,
    );
  }

  if (oldToken.client.id !== client.id) {
    logger.warn('Client mismatch for refresh token', {
      tokenClientId: oldToken.client.id,
      requestClientId: client.id,
    });
    throw new RefreshError(
      'invalid_grant',
      'Invalid or expired refresh token',
      400,
    );
  }

  let upstreamToken: Awaited<ReturnType<typeof exchangeRefreshToken>>;
  try {
    logger.info('Exchanging refresh token with upstream');
    upstreamToken = await exchangeRefreshToken(
      providedRefreshToken.refreshToken,
    );
    logger.info('Upstream token exchange successful');
  } catch (error) {
    const isClientError =
      error instanceof Error &&
      'status' in error &&
      typeof (error as { status: unknown }).status === 'number' &&
      (error as { status: number }).status >= 400 &&
      (error as { status: number }).status < 500;

    logger.error('Upstream refresh token exchange failed', {
      error: error instanceof Error ? error.message : error,
      clientId: client.id,
      isClientError,
    });

    if (isClientError) {
      await model.deleteToken(oldToken);
      await model.deleteRefreshToken(providedRefreshToken);
      throw new RefreshError(
        'invalid_grant',
        'Invalid or expired refresh token',
        400,
      );
    }

    throw new RefreshError(
      'server_error',
      'Temporary error refreshing token, please retry',
      503,
    );
  }

  const now = Date.now();
  const expiresAt = now + toMilliseconds(upstreamToken.expiresIn() ?? 0);

  const newRefreshToken =
    upstreamToken.refresh_token ?? providedRefreshToken.refreshToken;

  if (!upstreamToken.access_token) {
    logger.error('Upstream token missing access_token', {
      hasAccessToken: !!upstreamToken.access_token,
      hasRefreshToken: !!upstreamToken.refresh_token,
    });
    throw new RefreshError(
      'server_error',
      'Invalid token response from upstream',
      502,
    );
  }

  logger.info('Saving new tokens from refresh');
  const token = await model.saveToken({
    accessToken: upstreamToken.access_token,
    refreshToken: newRefreshToken,
    expires_at: expiresAt,
    client: client,
    user: oldToken.user,
    scope: oldToken.scope,
    grant: oldToken.grant,
  });

  await model.saveRefreshToken({
    refreshToken: newRefreshToken,
    accessToken: token.accessToken,
  });

  if (!token.accessToken) {
    logger.error('Saved token missing accessToken after saveToken', {
      hasAccessToken: !!token.accessToken,
      hasRefreshToken: !!token.refreshToken,
    });
    throw new RefreshError('server_error', 'Failed to save token', 500);
  }

  const expiresIn = toSeconds(expiresAt - now);
  if (!Number.isFinite(expiresIn)) {
    logger.error('Invalid expiresIn calculated', { expiresAt, now, expiresIn });
    throw new RefreshError('server_error', 'Invalid token expiration', 500);
  }

  const scope = oldToken.scope;
  const scopeValue =
    typeof scope === 'string' || Array.isArray(scope) ? scope : undefined;

  const result: RefreshTokenResult = {
    access_token: token.accessToken,
    expires_in: expiresIn,
    token_type: 'bearer',
    refresh_token: token.refreshToken ?? newRefreshToken,
    scope: scopeValue,
  };

  // Cache the result for cross-instance deduplication (short TTL, best-effort).
  // Must complete before deleting old tokens so concurrent/cross-instance callers
  // can read the cached result if they hit RefreshError.
  await model
    .saveRefreshResult(refreshToken, {
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      expiresAt,
      scope: scopeValue,
    })
    .catch((err) => {
      logger.warn('Failed to cache refresh result', { err });
    });

  await model.deleteToken(oldToken);
  if (newRefreshToken !== providedRefreshToken.refreshToken) {
    await model.deleteRefreshToken(providedRefreshToken);
  }
  logger.info('Refresh token exchanged successfully');

  logger.info('Building refresh token response', {
    hasAccessToken: !!result.access_token,
    hasRefreshToken: !!result.refresh_token,
    expiresIn: result.expires_in,
    scopeType: typeof result.scope,
    scopeIsArray: Array.isArray(result.scope),
  });

  return result;
}

const extractClientCredentials = (
  request: NextRequest,
  formData: URLSearchParams,
) => {
  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith('Basic ')) {
    const credentials = atob(authorization.replace(/^Basic\s+/i, ''));
    const [clientId, clientSecret] = credentials.split(':');
    return { clientId, clientSecret };
  }

  return {
    clientId: formData.get('client_id') ?? undefined,
    clientSecret: formData.get('client_secret') ?? undefined,
  };
};

export async function POST(request: NextRequest) {
  logger.info('Token endpoint called');

  try {
    const contentType = request.headers.get('content-type');

    if (!contentType?.includes('application/x-www-form-urlencoded')) {
      logger.warn('Invalid content type for token request', { contentType });
      return NextResponse.json(
        {
          error: 'invalid_request',
          error_description: 'Invalid content type',
        },
        { status: 415 },
      );
    }

    const body = await request.text();
    const formData = new URLSearchParams(body);
    const grantType = formData.get('grant_type');

    logger.info('Token request parsed', { grantType });

    const { clientId, clientSecret } = extractClientCredentials(
      request,
      formData,
    );

    if (!clientId) {
      logger.warn('Token request missing client_id');
      return NextResponse.json(
        {
          error: 'invalid_request',
          error_description: 'client_id is required',
        },
        { status: 400 },
      );
    }

    const error = {
      error: 'invalid_client',
      error_description: 'client not found or invalid client credentials',
    };

    const client = await model.getClient(clientId, '');
    if (!client) {
      logger.warn('Client not found', { clientId });
      return NextResponse.json(error, { status: 400 });
    }

    const isPublicClient = client.tokenEndpointAuthMethod === 'none';
    if (!isPublicClient) {
      if (clientSecret !== client.secret) {
        logger.warn('Client secret mismatch', { clientId });
        return NextResponse.json(error, { status: 400 });
      }
    }

    if (grantType === 'authorization_code') {
      logger.info('Processing authorization_code grant');
      const code = formData.get('code');
      if (!code) {
        logger.warn('Authorization code missing');
        return NextResponse.json(
          {
            error: 'invalid_request',
            error_description: 'code is required',
          },
          { status: 400 },
        );
      }

      const authorizationCode = await model.getAuthorizationCode(code);
      if (!authorizationCode) {
        logger.warn('Invalid authorization code');
        return NextResponse.json(
          {
            error: 'invalid_grant',
            error_description: 'Invalid authorization code',
          },
          { status: 400 },
        );
      }
      logger.info('Authorization code found', {
        userId: authorizationCode.user?.id,
      });

      if (authorizationCode.client.id !== client.id) {
        logger.warn('Authorization code client mismatch', {
          codeClientId: authorizationCode.client.id,
          requestClientId: client.id,
        });
        return NextResponse.json(
          {
            error: 'invalid_grant',
            error_description: 'Invalid authorization code',
          },
          { status: 400 },
        );
      }

      if (authorizationCode.expiresAt < new Date()) {
        logger.warn('Authorization code expired');
        return NextResponse.json(
          {
            error: 'invalid_grant',
            error_description: 'Authorization code expired',
          },
          { status: 400 },
        );
      }

      const isPkceEnabled = authorizationCode.code_challenge !== undefined;
      const codeVerifier = formData.get('code_verifier');

      if (
        isPkceEnabled &&
        !verifyPKCE(
          authorizationCode.code_challenge!,
          authorizationCode.code_challenge_method!,
          codeVerifier ?? '',
        )
      ) {
        logger.warn('Invalid PKCE code verifier');
        return NextResponse.json(
          {
            error: 'invalid_grant',
            error_description: 'Invalid PKCE code verifier',
          },
          { status: 400 },
        );
      }

      const redirectUri = formData.get('redirect_uri');
      if (!isPkceEnabled && !redirectUri) {
        logger.warn('Missing redirect_uri for non-PKCE flow');
        return NextResponse.json(
          {
            error: 'invalid_request',
            error_description: 'redirect_uri is required when not using PKCE',
          },
          { status: 400 },
        );
      }
      if (redirectUri && !client.redirect_uris.includes(redirectUri)) {
        logger.warn('Invalid redirect_uri', { provided: redirectUri });
        return NextResponse.json(
          {
            error: 'invalid_request',
            error_description: 'Invalid redirect URI',
          },
          { status: 400 },
        );
      }

      // Save the token
      logger.info('Saving token for authorization_code grant');
      const token = await model.saveToken({
        accessToken: authorizationCode.token.access_token,
        refreshToken: authorizationCode.token.refresh_token,
        expires_at: authorizationCode.token.access_token_expires_at,
        client: client,
        user: authorizationCode.user,
        scope: authorizationCode.scope,
        grant: authorizationCode.grant,
      });

      await model.saveRefreshToken({
        refreshToken: token.refreshToken ?? '',
        accessToken: token.accessToken,
      });

      identify(
        {
          id: authorizationCode.user.id,
          name: authorizationCode.user.name,
          email: authorizationCode.user.email,
          isOrg: authorizationCode.user.isOrg ?? false,
        },
        {
          context: {
            client: {
              id: client.id,
              name: client.client_name,
            },
          },
        },
      );

      waitUntil(flushAnalytics());

      // Revoke the authorization code, it can only be used once
      await model.revokeAuthorizationCode(authorizationCode);
      logger.info('Authorization code exchanged successfully');

      return NextResponse.json({
        access_token: token.accessToken,
        expires_in: toSeconds(token.expires_at - Date.now()),
        token_type: 'bearer',
        refresh_token: token.refreshToken,
        scope: authorizationCode.scope,
      });
    } else if (grantType === 'refresh_token') {
      logger.info('Processing refresh_token grant');
      const refreshToken = formData.get('refresh_token');
      if (!refreshToken) {
        logger.warn('Refresh token missing from request');
        return NextResponse.json(
          {
            error: 'invalid_request',
            error_description: 'refresh_token is required',
          },
          { status: 400 },
        );
      }

      try {
        // Singleflight: concurrent requests on the same instance share one
        // execution. The first caller does the upstream exchange; others
        // await the same Promise.
        const result = await singleflight(`refresh:${refreshToken}`, () =>
          executeRefresh(refreshToken, client),
        );
        logger.info('Returning refresh token response');
        return NextResponse.json(result);
      } catch (error) {
        // Cross-instance fallback: if another instance already completed the
        // refresh, the distributed cache will have the result.
        if (error instanceof RefreshError) {
          const cached = await model
            .getRefreshResult(refreshToken)
            .catch(() => undefined);
          if (cached) {
            logger.info('Returning cached refresh result (cross-instance hit)');
            return NextResponse.json({
              access_token: cached.accessToken,
              expires_in: toSeconds(cached.expiresAt - Date.now()),
              token_type: 'bearer' as const,
              refresh_token: cached.refreshToken,
              scope: cached.scope,
            });
          }

          return NextResponse.json(
            {
              error: error.oauthError,
              error_description: error.description,
            },
            { status: error.statusCode },
          );
        }
        throw error;
      }
    }

    logger.warn('Invalid grant type', { grantType });
    return NextResponse.json(
      {
        error: 'unsupported_grant_type',
        error_description: 'Unsupported grant type',
      },
      { status: 400 },
    );
  } catch (error: unknown) {
    logger.error('Token endpoint error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return handleOAuthError(error, 'Token exchange error');
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
