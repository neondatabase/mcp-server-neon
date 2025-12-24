import { NextRequest, NextResponse } from 'next/server';
import { model } from '../../../mcp-src/oauth/model';
import { exchangeCode } from '../../../lib/oauth/client';
import { generateRandomString } from '../../../mcp-src/oauth/utils';
import { createNeonClient } from '../../../mcp-src/server/api';
import { logger } from '../../../mcp-src/utils/logger';
import type { AuthorizationCode } from 'oauth2-server';

type DownstreamAuthRequest = {
  responseType: string;
  clientId: string;
  redirectUri: string;
  scope: string[];
  state: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
};

const decodeAuthParams = (state: string): DownstreamAuthRequest => {
  const decoded = atob(state);
  return JSON.parse(decoded);
};

const toMilliseconds = (seconds: number): number => seconds * 1000;

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');

    if (!code || !state) {
      return NextResponse.json(
        { code: 'invalid_request', error: 'missing code or state' },
        { status: 400 },
      );
    }

    // Build the current URL for the code exchange
    const currentUrl = new URL(request.url);
    currentUrl.protocol = 'https:'; // Force HTTPS for production

    // Exchange the upstream authorization code for tokens
    const tokens = await exchangeCode(currentUrl, state);

    const requestParams = decodeAuthParams(state);

    const clientId = requestParams.clientId;
    const client = await model.getClient(clientId, '');
    if (!client) {
      return NextResponse.json(
        { code: 'invalid_request', error: 'invalid client id' },
        { status: 400 },
      );
    }

    // Standard authorization code grant
    const grantId = generateRandomString(16);
    const nonce = generateRandomString(32);
    const authCode = `${grantId}:${nonce}`;

    // Get the user's info from Neon
    const neonClient = createNeonClient(tokens.access_token);
    const { data: user } = await neonClient.getCurrentUserInfo();
    const expiresAt = Date.now() + toMilliseconds(tokens.expiresIn() ?? 0);

    // Save the authorization code with associated data
    const authCodeData: AuthorizationCode = {
      authorizationCode: authCode,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      createdAt: Date.now(),
      redirectUri: requestParams.redirectUri,
      scope: requestParams.scope.join(' '),
      client: client,
      user: {
        id: user.id,
        email: user.email,
        name: `${user.name} ${user.last_name}`.trim(),
      },
      token: {
        access_token: tokens.access_token,
        access_token_expires_at: expiresAt,
        refresh_token: tokens.refresh_token,
        id_token: tokens.id_token,
      },
      code_challenge: requestParams.codeChallenge,
      code_challenge_method: requestParams.codeChallengeMethod,
    };

    await model.saveAuthorizationCode(authCodeData);

    // Redirect back to client with auth code
    const redirectUrl = new URL(requestParams.redirectUri);
    redirectUrl.searchParams.set('code', authCode);
    if (requestParams.state) {
      redirectUrl.searchParams.set('state', requestParams.state);
    }

    return NextResponse.redirect(redirectUrl.href);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('OAuth callback error:', { message, error });
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
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
