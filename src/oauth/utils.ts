import { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { model } from './model.js';

export const ensureCorsHeaders = () =>
  cors({
    origin: true,
    methods: '*',
    allowedHeaders: 'Authorization, Origin, Content-Type, Accept, *',
  });

export const requiresAuth =
  () => async (request: Request, response: Response, next: NextFunction) => {
    const authorization = request.headers.authorization;
    if (!authorization) {
      response.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const token = await model.getAccessToken(extractBearerToken(authorization));
    if (!token) {
      response.status(401).json({ error: 'Invalid access token' });
      return;
    }

    if (!token.expires_at || token.expires_at < Date.now()) {
      response.status(401).json({ error: 'Access token expired' });
      return;
    }

    next();
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
