import { Request } from 'express';
import {
  discovery,
  buildAuthorizationUrl,
  authorizationCodeGrant,
  ClientSecretPost,
  refreshTokenGrant,
} from 'openid-client';
import {
  CLIENT_ID,
  CLIENT_SECRET,
  UPSTREAM_OAUTH_HOST,
  REDIRECT_URI,
  SERVER_HOST,
} from '../constants';
import { logger } from '../utils/logger';

const NEON_MCP_SCOPES = [
  'openid',
  'offline',
  'offline_access',
  'urn:neoncloud:projects:create',
  'urn:neoncloud:projects:read',
  'urn:neoncloud:projects:update',
  'urn:neoncloud:projects:delete',
  'urn:neoncloud:orgs:create',
  'urn:neoncloud:orgs:read',
  'urn:neoncloud:orgs:update',
  'urn:neoncloud:orgs:delete',
  'urn:neoncloud:orgs:permission',
] as const;

const getUpstreamConfig = async () => {
  const url = new URL(UPSTREAM_OAUTH_HOST);
  const config = await discovery(
    url,
    CLIENT_ID,
    {
      client_secret: CLIENT_SECRET,
    },
    ClientSecretPost(CLIENT_SECRET),
    {},
  );

  return config;
};

export const upstreamAuth = async (state: string) => {
  const config = await getUpstreamConfig();
  return buildAuthorizationUrl(config, {
    redirect_uri: REDIRECT_URI,
    token_endpoint_auth_method: 'client_secret_post',
    scope: NEON_MCP_SCOPES.join(' '),
    response_type: 'code',
    state,
  });
};

export const exchangeCode = async (req: Request) => {
  try {
    const config = await getUpstreamConfig();
    const currentUrl = new URL(req.originalUrl, SERVER_HOST);
    return await authorizationCodeGrant(config, currentUrl, {
      expectedState: req.query.state as string,
      idTokenExpected: true,
    });
  } catch (error: unknown) {
    logger.error('failed to exchange code:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      error,
    });
    throw error;
  }
};

export const exchangeRefreshToken = async (token: string) => {
  const config = await getUpstreamConfig();
  return refreshTokenGrant(config, token);
};
