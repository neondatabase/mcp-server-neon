import {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from 'express';
import { AuthorizationCode, Client } from 'oauth2-server';
import { Model } from './model.js';
import { logger } from '../utils/logger.js';
import express from 'express';
import {
  decodeAuthParams,
  generateRandomString,
  parseAuthRequest,
} from './utils.js';
import { exchangeCode, upstreamAuth } from './client.js';
import { createNeonClient } from '../server/api.js';
import bodyParser from 'body-parser';

const model = new Model();
export const metadata = (req: ExpressRequest, res: ExpressResponse) => {
  res.json({
    issuer: 'http://localhost:3001',
    authorization_endpoint: 'http://localhost:3001/authorize',
    token_endpoint: 'http://localhost:3001/token',
    registration_endpoint: 'http://localhost:3001/register',
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: [
      'client_secret_basic',
      'client_secret_post',
      'none',
    ],
    registration_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
  });
};

export const registerClient = async (
  req: ExpressRequest,
  res: ExpressResponse,
) => {
  try {
    logger.info('request to register client: ', {
      name: req.body.client_name,
    });
    const { client_name, redirect_uris, grant_types, response_types } =
      req.body;
    const clientId = generateRandomString(8);
    const clientSecret = generateRandomString(32);

    const client: Client = {
      id: clientId,
      secret: clientSecret,
      name: client_name,
      redirectUris: redirect_uris,
      grants: grant_types,
      responseTypes: response_types,
    };

    await model.saveClient(client);
    logger.info('new client registered', {
      clientId,
      client_name,
      redirect_uris,
    });

    res.json({
      client_id: clientId,
      client_secret: clientSecret,
      client_name,
      redirect_uris,
    });
  } catch (error) {
    logger.error('failed to register client:', {
      error,
      client: req.body.client_name,
    });
    res.status(400).json({ error: 'Invalid request' });
  }
};

const authRouter = express.Router();
authRouter.get('/.well-known/oauth-authorization-server', metadata);
authRouter.post('/register', bodyParser.json(), registerClient);
authRouter.get(
  '/authorize',
  bodyParser.urlencoded({ extended: true }),
  async (req: ExpressRequest, res: ExpressResponse) => {
    const requestParams = parseAuthRequest(req);
    const authUrl = await upstreamAuth(btoa(JSON.stringify(requestParams)));
    res.redirect(authUrl.href);
  },
);
authRouter.get(
  '/callback',
  bodyParser.urlencoded({ extended: true }),
  async (req: ExpressRequest, res: ExpressResponse) => {
    const tokens = await exchangeCode(req);
    const state = req.query.state as string;
    const requestParams = decodeAuthParams(state);

    if (requestParams.responseType === 'code') {
      const grantId = generateRandomString(16);
      const secret = generateRandomString(32);
      const authCode = `${grantId}:${secret}`;
      const clientId = requestParams.clientId;

      const neonClient = createNeonClient(tokens.access_token);

      const { data: user } = await neonClient.getCurrentUserInfo();

      // Save the authorization code with associated data
      const code: AuthorizationCode = {
        authorizationCode: authCode,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
        redirectUri: requestParams.redirectUri,
        scope: requestParams.scope.join(' '),
        client: await model.getClient(clientId, ''),
        user: {
          id: user.id,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          email: user.email,
          name: `${user.name} ${user.last_name}`.trim(),
        },
      };

      await model.saveAuthorizationCode(code);

      // Redirect back to client with auth code
      const redirectUrl = new URL(requestParams.redirectUri);
      redirectUrl.searchParams.set('code', authCode);
      redirectUrl.searchParams.set('state', requestParams.state);

      res.redirect(redirectUrl.href);
    } else {
      res.status(401).json({
        message: 'Callback received',
        state,
        requestParams,
      });
    }
  },
);

authRouter.post(
  '/token',
  bodyParser.urlencoded({ extended: true }),
  async (req: ExpressRequest, res: ExpressResponse) => {
    const contentType = req.headers['content-type'] as string;
    if (contentType !== 'application/x-www-form-urlencoded') {
      res.status(400).json({ error: `invalid content type: ${contentType}` });
      return;
    }

    const formData = req.body;
    if (!formData.client_id) {
      res.status(400).json({ error: 'client_id is required' });
      return;
    }

    const client = await model.getClient(
      formData.client_id,
      formData.client_secret,
    );
    if (!client) {
      res
        .status(400)
        .json({ error: `client not found: ${formData.client_id}` });
      return;
    }

    if (client.secret !== formData.client_secret) {
      // For security reasons, do not leak whether a client exists or not.
      res.status(400).json({ error: 'invalid client_secret' });
      return;
    }

    if (formData.grant_type === 'authorization_code') {
      const code = await model.getAuthorizationCode(formData.code);
      if (!code) {
        res.status(400).json({ error: `invalid authorization code` });
        return;
      }

      const authorizationCode = await model.getAuthorizationCode(formData.code);
      if (authorizationCode.client.id !== client.id) {
        res.status(400).json({ error: `invalid authorization code` });
        return;
      }
      if (authorizationCode.expiresAt < new Date()) {
        res.status(400).json({ error: 'authorization code expired' });
        return;
      }

      const token = await model.saveToken({
        accessToken: authorizationCode.user.access_token,
        refreshToken: authorizationCode.user.refresh_token,
        client: client,
        user: authorizationCode.user,
      });

      // Revoke the authorization code, it can only be used once
      await model.revokeAuthorizationCode(authorizationCode);
      res.json({
        access_token: token.accessToken,
        token_type: 'bearer',
        refresh_token: token.refreshToken,
        scope: authorizationCode.scope,
      });
      return;
    }
    res.status(400).json({ error: 'invalid grant type' });
  },
);

export { authRouter };
