import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { model } from '../../../mcp-src/oauth/model';
import { exchangeRefreshToken } from '../../../lib/oauth/client';
import { verifyPKCE } from '../../../mcp-src/oauth/utils';
import { identify, flushAnalytics } from '../../../mcp-src/analytics/analytics';
import { handleOAuthError } from '../../../lib/errors';
import { logger } from '../../../mcp-src/utils/logger';
import type { GrantContext } from '../../../mcp-src/utils/grant-context';

const toSeconds = (ms: number): number => Math.floor(ms / 1000);
const toMilliseconds = (seconds: number): number => seconds * 1000;

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
      logger.info('Authorization code found', { userId: authorizationCode.user?.id });

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

      // Save the token (including grant context from OAuth consent)
      logger.info('Saving token for authorization_code grant');
      const authCodeWithGrant = authorizationCode as typeof authorizationCode & {
        grant?: GrantContext;
      };
      const token = await model.saveToken({
        accessToken: authorizationCode.token.access_token,
        refreshToken: authorizationCode.token.refresh_token,
        expires_at: authorizationCode.token.access_token_expires_at,
        client: client,
        user: authorizationCode.user,
        scope: authorizationCode.scope,
        grant: authCodeWithGrant.grant,
      } as Parameters<typeof model.saveToken>[0]);

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

      const providedRefreshToken = await model.getRefreshToken(refreshToken);
      if (!providedRefreshToken) {
        logger.warn('Refresh token not found in storage');
        return NextResponse.json(
          {
            error: 'invalid_grant',
            error_description: 'Invalid refresh token',
          },
          { status: 400 },
        );
      }

      const oldToken = await model.getAccessToken(
        providedRefreshToken.accessToken,
      );
      if (!oldToken) {
        logger.warn('Access token for refresh token not found, cleaning up');
        // Refresh token is missing its counter access token, delete it
        await model.deleteRefreshToken(providedRefreshToken);
        return NextResponse.json(
          {
            error: 'invalid_grant',
            error_description: 'Invalid refresh token',
          },
          { status: 400 },
        );
      }

      if (oldToken.client.id !== client.id) {
        logger.warn('Client mismatch for refresh token', {
          tokenClientId: oldToken.client.id,
          requestClientId: client.id,
        });
        return NextResponse.json(
          {
            error: 'invalid_grant',
            error_description: 'Invalid refresh token',
          },
          { status: 400 },
        );
      }

      let upstreamToken;
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
          // Only delete tokens on explicit 4xx rejection (invalid/revoked)
          await model.deleteToken(oldToken);
          await model.deleteRefreshToken(providedRefreshToken);

          return NextResponse.json(
            {
              error: 'invalid_grant',
              error_description: 'Refresh token is expired or revoked',
            },
            { status: 400 },
          );
        }

        // Transient error (5xx, network) - don't delete tokens, return server error
        return NextResponse.json(
          {
            error: 'server_error',
            error_description: 'Temporary error refreshing token, please retry',
          },
          { status: 503 },
        );
      }

      const now = Date.now();
      const expiresAt = now + toMilliseconds(upstreamToken.expiresIn() ?? 0);

      // Use new refresh token if provided, otherwise keep the old one
      const newRefreshToken =
        upstreamToken.refresh_token ?? providedRefreshToken.refreshToken;

      // Validate upstream token has required fields
      if (!upstreamToken.access_token) {
        logger.error('Upstream token missing access_token', {
          hasAccessToken: !!upstreamToken.access_token,
          hasRefreshToken: !!upstreamToken.refresh_token,
        });
        return NextResponse.json(
          {
            error: 'server_error',
            error_description: 'Invalid token response from upstream',
          },
          { status: 502 },
        );
      }

      // Preserve grant context from the old token through refresh
      logger.info('Saving new tokens from refresh');
      const oldTokenWithGrant = oldToken as typeof oldToken & {
        grant?: GrantContext;
      };
      const token = await model.saveToken({
        accessToken: upstreamToken.access_token,
        refreshToken: newRefreshToken,
        expires_at: expiresAt,
        client: client,
        user: oldToken.user,
        scope: oldToken.scope,
        grant: oldTokenWithGrant.grant,
      } as Parameters<typeof model.saveToken>[0]);

      await model.saveRefreshToken({
        refreshToken: newRefreshToken,
        accessToken: token.accessToken,
      });

      // Delete the old tokens
      await model.deleteToken(oldToken);
      await model.deleteRefreshToken(providedRefreshToken);
      logger.info('Refresh token exchanged successfully');

      // Validate saved token has required fields
      if (!token.accessToken) {
        logger.error('Saved token missing accessToken after saveToken', {
          hasAccessToken: !!token.accessToken,
          hasRefreshToken: !!token.refreshToken,
        });
        return NextResponse.json(
          {
            error: 'server_error',
            error_description: 'Failed to save token',
          },
          { status: 500 },
        );
      }

      // Calculate expires_in and validate it's a valid number
      const expiresIn = toSeconds(expiresAt - now);
      if (!Number.isFinite(expiresIn)) {
        logger.error('Invalid expiresIn calculated', {
          expiresAt,
          now,
          expiresIn,
        });
        return NextResponse.json(
          {
            error: 'server_error',
            error_description: 'Invalid token expiration',
          },
          { status: 500 },
        );
      }

      // Ensure scope is serializable (string, array of strings, or undefined)
      const scope = oldToken.scope;
      const scopeValue =
        typeof scope === 'string' || Array.isArray(scope) ? scope : undefined;

      // Build response object explicitly to ensure serializable values
      const responseBody = {
        access_token: token.accessToken,
        expires_in: expiresIn,
        token_type: 'bearer' as const,
        refresh_token: token.refreshToken ?? newRefreshToken,
        scope: scopeValue,
      };

      logger.info('Building refresh token response', {
        hasAccessToken: !!responseBody.access_token,
        hasRefreshToken: !!responseBody.refresh_token,
        expiresIn: responseBody.expires_in,
        scopeType: typeof responseBody.scope,
        scopeIsArray: Array.isArray(responseBody.scope),
      });

      const response = NextResponse.json(responseBody);
      logger.info('Returning refresh token response');
      return response;
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
