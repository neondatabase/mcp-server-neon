import { NextFunction, Request, Response } from 'express';
import cors from 'cors';

export const ensureCorsHeaders = () =>
  cors({
    origin: true,
    methods: '*',
    allowedHeaders: 'Authorization, Origin, Content-Type, Accept, *',
  });

export const requiresAuth =
  () => (request: Request, response: Response, next: NextFunction) => {
    const authorization = request.headers.authorization;
    if (!authorization) {
      response.status(401).json({ error: 'Unauthorized' });
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
