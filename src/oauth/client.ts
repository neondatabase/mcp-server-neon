import { Request } from 'express';
import {
  discovery,
  allowInsecureRequests,
  buildAuthorizationUrl,
  authorizationCodeGrant,
  None,
} from 'openid-client';
import {
  CLIENT_ID,
  CLIENT_SECRET,
  UPSTREAM_OAUTH_HOST,
  REDIRECT_URI,
} from '../constants.js';

const ALWAYS_PRESENT_SCOPES = ['openid', 'offline', 'offline_access'] as const;
const NEONCTL_SCOPES = [
  ...ALWAYS_PRESENT_SCOPES,
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
    None(),
    {
      execute: [allowInsecureRequests],
    },
  );

  return config;
};

export const upstreamAuth = async (state: string) => {
  const config = await getUpstreamConfig();
  return buildAuthorizationUrl(config, {
    redirect_uri: REDIRECT_URI,
    token_endpoint_auth_method: 'none',
    scope: NEONCTL_SCOPES.join(' '),
    response_type: 'code',
    state,
  });
};

export const exchangeCode = async (req: Request) => {
  const config = await getUpstreamConfig();
  const currentUrl = new URL(
    req.originalUrl,
    `${req.protocol}://${req.get('host')}`,
  );
  return authorizationCodeGrant(config, currentUrl, {
    expectedState: req.query.state as string,
    idTokenExpected: true,
  });
};
