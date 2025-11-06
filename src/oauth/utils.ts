import { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { model } from './model.js';
import { ApiKeyRecord, apiKeys } from './kv-store.js';
import { createNeonClient } from '../server/api.js';
import { identify } from '../analytics/analytics.js';

export const ensureCorsHeaders = () =>
  cors({
    origin: true,
    methods: '*',
    allowedHeaders: 'Authorization, Origin, Content-Type, Accept, X-Read-Only, *',
  });

const fetchAccountDetails = async (
  accessToken: string,
): Promise<ApiKeyRecord | null> => {
  const apiKeyRecord = await apiKeys.get(accessToken);
  if (apiKeyRecord) {
    return apiKeyRecord;
  }

  try {
    const neonClient = createNeonClient(accessToken);
    const { data: auth } = await neonClient.getAuthDetails();
    if (auth.auth_method === 'api_key_org') {
      const { data: org } = await neonClient.getOrganization(auth.account_id);
      const record = {
        apiKey: accessToken,
        authMethod: auth.auth_method,
        account: {
          id: auth.account_id,
          name: org.name,
          isOrg: true,
        },
      };
      identify(record.account, { context: { authMethod: record.authMethod } });
      await apiKeys.set(accessToken, record);
      return record;
    }
    const { data: user } = await neonClient.getCurrentUserInfo();
    const record = {
      apiKey: accessToken,
      authMethod: auth.auth_method,
      account: {
        id: user.id,
        name: user.name,
        email: user.email,
        isOrg: false,
      },
    };
    identify(record.account, { context: { authMethod: record.authMethod } });
    await apiKeys.set(accessToken, record);
    return record;
  } catch {
    return null;
  }
};

export const requiresAuth =
  () => async (request: Request, response: Response, next: NextFunction) => {
    const authorization = request.headers.authorization;
    if (!authorization) {
      response.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const accessToken = extractBearerToken(authorization);
    // Check for X-Read-Only header
    const readOnlyHeader = request.headers['x-read-only'];
    const readOnly = readOnlyHeader === 'true' || readOnlyHeader === '1';

    const token = await model.getAccessToken(accessToken);
    if (token) {
      if (!token.expires_at || token.expires_at < Date.now()) {
        response.status(401).json({ error: 'Access token expired' });
        return;
      }

      request.auth = {
        token: token.accessToken,
        clientId: token.client.id,
        scopes: Array.isArray(token.scope)
          ? token.scope
          : (token.scope?.split(' ') ?? []),
        extra: {
          account: {
            id: token.user.id,
            name: token.user.name,
            email: token.user.email,
            isOrg: false,
          },
          client: {
            id: token.client.id,
            name: token.client.client_name,
          },
          readOnly,
        },
      };

      next();
      return;
    }

    // If the token is not found, try to resolve the auth headers with Neon for other means of authentication.
    const apiKeyRecord = await fetchAccountDetails(accessToken);
    if (!apiKeyRecord) {
      response.status(401).json({ error: 'Invalid access token' });
      return;
    }
    request.auth = {
      token: accessToken,
      clientId: 'api-key',
      scopes: ['*'],
      extra: {
        account: apiKeyRecord.account,
        readOnly,
      },
    };
    next();
    return;
  };

export type DownstreamAuthRequest = {
  responseType: string;
  clientId: string;
  redirectUri: string;
  scope: string[];
  state: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
};

export const parseAuthRequest = (request: Request): DownstreamAuthRequest => {
  const responseType = (request.query.response_type || '') as string;
  const clientId = (request.query.client_id || '') as string;
  const redirectUri = (request.query.redirect_uri || '') as string;
  const scope = (request.query.scope || '') as string;
  const state = (request.query.state || '') as string;
  const codeChallenge = (request.query.code_challenge as string) || undefined;
  const codeChallengeMethod = (request.query.code_challenge_method ||
    'plain') as string;

  return {
    responseType,
    clientId,
    redirectUri,
    scope: scope.split(' ').filter(Boolean),
    state,
    codeChallenge,
    codeChallengeMethod,
  };
};

export const decodeAuthParams = (state: string): DownstreamAuthRequest => {
  const decoded = atob(state);
  return JSON.parse(decoded);
};

export const generateRandomString = (length: number): string => {
  const charset =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => charset[byte % charset.length]).join('');
};

export const extractBearerToken = (authorizationHeader: string): string => {
  if (!authorizationHeader) return '';
  return authorizationHeader.replace(/^Bearer\s+/i, '');
};

export const extractClientCredentials = (request: Request) => {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Basic ')) {
    const credentials = atob(authorization.replace(/^Basic\s+/i, ''));
    const [clientId, clientSecret] = credentials.split(':');
    return { clientId, clientSecret };
  }

  return {
    clientId: request.body.client_id,
    clientSecret: request.body.client_secret,
  };
};

export const toSeconds = (ms: number): number => {
  return Math.floor(ms / 1000);
};

export const toMilliseconds = (seconds: number): number => {
  return seconds * 1000;
};

export const verifyPKCE = (
  codeChallenge: string,
  codeChallengeMethod: string,
  codeVerifier: string,
): boolean => {
  if (!codeChallenge || !codeChallengeMethod || !codeVerifier) {
    return false;
  }

  if (codeChallengeMethod === 'S256') {
    const hash = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    return codeChallenge === hash;
  }

  if (codeChallengeMethod === 'plain') {
    return codeChallenge === codeVerifier;
  }

  return false;
};
