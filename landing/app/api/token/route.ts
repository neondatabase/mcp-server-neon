import { NextRequest, NextResponse } from 'next/server';
import { model } from '../../../mcp-src/oauth/model';
import { exchangeRefreshToken } from '../../../lib/oauth/client';
import { verifyPKCE } from '../../../mcp-src/oauth/utils';
import { identify, flushAnalytics } from '../../../mcp-src/analytics/analytics';
import { logger } from '../../../mcp-src/utils/logger';

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
  try {
    const contentType = request.headers.get('content-type');
    if (!contentType?.includes('application/x-www-form-urlencoded')) {
      return NextResponse.json(
        { code: 'invalid_request', error: 'invalid content type' },
        { status: 415 },
      );
    }

    const body = await request.text();
    const formData = new URLSearchParams(body);

    const { clientId, clientSecret } = extractClientCredentials(
      request,
      formData,
    );
    if (!clientId) {
      return NextResponse.json(
        { code: 'invalid_request', error: 'client_id is required' },
        { status: 400 },
      );
    }

    const error = {
      error: 'invalid_client',
      error_description: 'client not found or invalid client credentials',
    };
    const client = await model.getClient(clientId, '');
    if (!client) {
      return NextResponse.json(
        { code: 'invalid_request', ...error },
        { status: 400 },
      );
    }

    const isPublicClient = client.tokenEndpointAuthMethod === 'none';
    if (!isPublicClient) {
      if (clientSecret !== client.secret) {
        return NextResponse.json(
          { code: 'invalid_request', ...error },
          { status: 400 },
        );
      }
    }

    const grantType = formData.get('grant_type');

    if (grantType === 'authorization_code') {
      const code = formData.get('code');
      if (!code) {
        return NextResponse.json(
          { code: 'invalid_request', error: 'code is required' },
          { status: 400 },
        );
      }

      const authorizationCode = await model.getAuthorizationCode(code);
      if (!authorizationCode) {
        return NextResponse.json(
          { code: 'invalid_request', error: 'invalid authorization code' },
          { status: 400 },
        );
      }

      if (authorizationCode.client.id !== client.id) {
        return NextResponse.json(
          { code: 'invalid_request', error: 'invalid authorization code' },
          { status: 400 },
        );
      }

      if (authorizationCode.expiresAt < new Date()) {
        return NextResponse.json(
          { code: 'invalid_request', error: 'authorization code expired' },
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
        return NextResponse.json(
          { code: 'invalid_grant', error: 'invalid PKCE code verifier' },
          { status: 400 },
        );
      }

      const redirectUri = formData.get('redirect_uri');
      if (!isPkceEnabled && !redirectUri) {
        return NextResponse.json(
          {
            code: 'invalid_request',
            error: 'redirect_uri is required when not using PKCE',
          },
          { status: 400 },
        );
      }
      if (redirectUri && !client.redirect_uris.includes(redirectUri)) {
        return NextResponse.json(
          { code: 'invalid_request', error: 'invalid redirect uri' },
          { status: 400 },
        );
      }

      // Save the token
      const token = await model.saveToken({
        accessToken: authorizationCode.token.access_token,
        refreshToken: authorizationCode.token.refresh_token,
        expires_at: authorizationCode.token.access_token_expires_at,
        client: client,
        user: authorizationCode.user,
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

      await flushAnalytics();

      // Revoke the authorization code, it can only be used once
      await model.revokeAuthorizationCode(authorizationCode);

      return NextResponse.json({
        access_token: token.accessToken,
        expires_in: toSeconds(token.expires_at - Date.now()),
        token_type: 'bearer',
        refresh_token: token.refreshToken,
        scope: authorizationCode.scope,
      });
    } else if (grantType === 'refresh_token') {
      const refreshToken = formData.get('refresh_token');
      if (!refreshToken) {
        return NextResponse.json(
          { code: 'invalid_request', error: 'refresh_token is required' },
          { status: 400 },
        );
      }

      const providedRefreshToken = await model.getRefreshToken(refreshToken);
      if (!providedRefreshToken) {
        return NextResponse.json(
          { code: 'invalid_request', error: 'invalid refresh token' },
          { status: 400 },
        );
      }

      const oldToken = await model.getAccessToken(
        providedRefreshToken.accessToken,
      );
      if (!oldToken) {
        // Refresh token is missing its counter access token, delete it
        await model.deleteRefreshToken(providedRefreshToken);
        return NextResponse.json(
          { code: 'invalid_request', error: 'invalid refresh token' },
          { status: 400 },
        );
      }

      if (oldToken.client.id !== client.id) {
        return NextResponse.json(
          { code: 'invalid_request', error: 'invalid refresh token' },
          { status: 400 },
        );
      }

      const upstreamToken = await exchangeRefreshToken(
        providedRefreshToken.refreshToken,
      );
      const now = Date.now();
      const expiresAt = now + toMilliseconds(upstreamToken.expiresIn() ?? 0);
      const token = await model.saveToken({
        accessToken: upstreamToken.access_token,
        refreshToken: upstreamToken.refresh_token ?? '',
        expires_at: expiresAt,
        client: client,
        user: oldToken.user,
      });
      await model.saveRefreshToken({
        refreshToken: token.refreshToken ?? '',
        accessToken: token.accessToken,
      });

      // Delete the old tokens
      await model.deleteToken(oldToken);
      await model.deleteRefreshToken(providedRefreshToken);

      return NextResponse.json({
        access_token: token.accessToken,
        expires_in: toSeconds(expiresAt - now),
        token_type: 'bearer',
        refresh_token: token.refreshToken,
        scope: oldToken.scope,
      });
    }

    return NextResponse.json(
      { code: 'invalid_request', error: 'invalid grant type' },
      { status: 400 },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Token exchange error:', { message, error });
    return NextResponse.json(
      { code: 'server_error', error: message },
      { status: 500 },
    );
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
