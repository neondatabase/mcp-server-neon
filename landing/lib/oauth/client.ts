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
  SERVER_HOST,
  UPSTREAM_OAUTH_HOST,
} from '../config';

const REDIRECT_URI = `${SERVER_HOST}/api/callback`;

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

export const exchangeCode = async (currentUrl: URL, state: string) => {
  const config = await getUpstreamConfig();
  return await authorizationCodeGrant(config, currentUrl, {
    expectedState: state,
    idTokenExpected: true,
  });
};

export const exchangeRefreshToken = async (token: string) => {
  const config = await getUpstreamConfig();
  return refreshTokenGrant(config, token);
};
