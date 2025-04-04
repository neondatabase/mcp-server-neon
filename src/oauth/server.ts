import {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from 'express';
import { AuthorizationCode, Client } from 'oauth2-server';
import { model } from './model.js';
import { logger } from '../utils/logger.js';
import express from 'express';
import {
  decodeAuthParams,
  generateRandomString,
  parseAuthRequest,
  toMilliseconds,
  toSeconds,
} from './utils.js';
import { exchangeCode, exchangeRefreshToken, upstreamAuth } from './client.js';
import { createNeonClient } from '../server/api.js';
import bodyParser from 'body-parser';
import { SERVER_HOST } from '../constants.js';

export const metadata = (req: ExpressRequest, res: ExpressResponse) => {
  res.json({
    issuer: SERVER_HOST,
    authorization_endpoint: `${SERVER_HOST}/authorize`,
    token_endpoint: `${SERVER_HOST}/token`,
    registration_endpoint: `${SERVER_HOST}/register`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    registration_endpoint_auth_methods_supported: [
      'none',
      'client_secret_post',
    ],
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
      tokenEndpointAuthMethod:
        (req.body.token_endpoint_auth_method as string) ?? 'client_secret_post',
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
  } catch (error: unknown) {
    logger.error('failed to register client:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      client: req.body.client_name,
    });
    res.status(400).json({ error: 'Invalid request' });
  }
};

const authRouter = express.Router();
authRouter.get('/.well-known/oauth-authorization-server', metadata);
authRouter.post('/register', bodyParser.json(), registerClient);

/*
  Initiate the authorization code grant flow by redirecting to the upstream
  authorization server.
  
  Step 1:
  MCP client should invoke this endpoint with the following parameters:
  <code>
    /authorize?client_id=clientId&redirect_uri=mcp://callback&response_type=code&scope=scope&code_challenge=codeChallenge&code_challenge_method=S256
  </code>

  This endpoint will capture the parameters on `state` param and redirect to the upstream authorization server.
*/
authRouter.get(
  '/authorize',
  bodyParser.urlencoded({ extended: true }),
  async (req: ExpressRequest, res: ExpressResponse) => {
    const requestParams = parseAuthRequest(req);
    const authUrl = await upstreamAuth(btoa(JSON.stringify(requestParams)));
    res.redirect(authUrl.href);
  },
);

/*
  Handles the callback from the upstream authorization server and completes the authorization code grant flow with downstream MCP client.

  Step 2:
  Upstream authorization server will redirect to `/callback` with the authorization code.
  <code>
    /callback?code=authorizationCode&state=state
  </code>

  - Exchange the upstream authorization code for an access token.
  - Generate new authorization code and grant id.
  - Save the authorization code and access token in the database.
  - Redirect to the MCP client with the new authorization code.
*/
authRouter.get(
  '/callback',
  bodyParser.urlencoded({ extended: true }),
  async (req: ExpressRequest, res: ExpressResponse) => {
    const tokens = await exchangeCode(req);
    const state = req.query.state as string;
    const requestParams = decodeAuthParams(state);

    // Implicit grant or `response_type=token` is not supported
    if (requestParams.responseType !== 'code') {
      res
        .status(400)
        .json({ code: 'invalid_request', error: 'invalid response type' });
      return;
    }

    const clientId = requestParams.clientId;
    const client = await model.getClient(clientId, '');
    if (!client) {
      res
        .status(400)
        .json({ code: 'invalid_request', error: 'invalid client id' });
      return;
    }

    // Standard authorization code grant
    const grantId = generateRandomString(16);
    const secret = generateRandomString(32);
    const authCode = `${grantId}:${secret}`;

    // Get the user's info from Neon
    const neonClient = createNeonClient(tokens.access_token);
    const { data: user } = await neonClient.getCurrentUserInfo();
    const expiresAt = Date.now() + toMilliseconds(tokens.expiresIn() ?? 0);
    // Save the authorization code with associated data
    const code: AuthorizationCode = {
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
    };

    await model.saveAuthorizationCode(code);

    // Redirect back to client with auth code
    const redirectUrl = new URL(requestParams.redirectUri);
    redirectUrl.searchParams.set('code', authCode);
    if (requestParams.state) {
      redirectUrl.searchParams.set('state', requestParams.state);
    }

    res.redirect(redirectUrl.href);
  },
);

/*
  Handles the token exchange for `code` and `refresh_token` grant types with downstream MCP client.

  Step 3:
  MCP client should invoke this endpoint after receiving the authorization code to exchange for an access token.
  <code>
    /token?client_id=clientId&grant_type=code&code=authorizationCode
  </code>

  - Verify the authorization code, grant type and client
  - Save the access token and refresh token in the database for further API requests verification
  - Return with access token and refresh token
*/
authRouter.post(
  '/token',
  bodyParser.urlencoded({ extended: true }),
  async (req: ExpressRequest, res: ExpressResponse) => {
    const contentType = req.headers['content-type'] as string;
    if (contentType !== 'application/x-www-form-urlencoded') {
      res
        .status(415)
        .json({ code: 'invalid_request', error: 'invalid content type' });
      return;
    }

    const formData = req.body;
    if (!formData.client_id) {
      res
        .status(400)
        .json({ code: 'invalid_request', error: 'client_id is required' });
      return;
    }

    const client = await model.getClient(formData.client_id, '');
    if (!client) {
      res
        .status(400)
        .json({ code: 'invalid_request', error: 'invalid client' });
      return;
    }

    if (client.secret !== formData.client_secret) {
      // For security reasons, do not leak whether a client exists or not.
      res
        .status(400)
        .json({ code: 'invalid_request', error: 'invalid client' });
      return;
    }

    if (formData.grant_type === 'authorization_code') {
      const authorizationCode = await model.getAuthorizationCode(formData.code);
      if (!authorizationCode) {
        res.status(400).json({
          code: 'invalid_request',
          error: 'invalid authorization code',
        });
        return;
      }

      if (authorizationCode.client.id !== client.id) {
        res.status(400).json({
          code: 'invalid_request',
          error: 'invalid authorization code',
        });
        return;
      }
      if (authorizationCode.expiresAt < new Date()) {
        res.status(400).json({
          code: 'invalid_request',
          error: 'authorization code expired',
        });
        return;
      }

      // TODO: Generate fresh tokens and add mapping to database.
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

      // Revoke the authorization code, it can only be used once
      await model.revokeAuthorizationCode(authorizationCode);
      res.json({
        access_token: token.accessToken,
        expires_in: toSeconds(token.expires_at - Date.now()),
        token_type: 'bearer', // TODO: Verify why non-bearer tokens are not working
        refresh_token: token.refreshToken,
        scope: authorizationCode.scope,
      });
      return;
    } else if (formData.grant_type === 'refresh_token') {
      const providedRefreshToken = await model.getRefreshToken(
        formData.refresh_token,
      );
      if (!providedRefreshToken) {
        res
          .status(400)
          .json({ code: 'invalid_request', error: 'invalid refresh token' });
        return;
      }

      const oldToken = await model.getAccessToken(
        providedRefreshToken.accessToken,
      );
      if (!oldToken) {
        // Refresh token is missing it counter access token, delete it
        await model.deleteRefreshToken(providedRefreshToken);
        res
          .status(400)
          .json({ code: 'invalid_request', error: 'invalid refresh token' });
        return;
      }

      if (oldToken.client.id !== client.id) {
        res
          .status(400)
          .json({ code: 'invalid_request', error: 'invalid refresh token' });
        return;
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
        refreshToken: token.refresh_token ?? '',
        accessToken: token.access_token,
      });

      // Delete the old tokens
      await model.deleteToken(oldToken);
      await model.deleteRefreshToken(providedRefreshToken);

      res.json({
        access_token: token.accessToken,
        expires_in: toSeconds(expiresAt - now),
        token_type: 'bearer',
        refresh_token: token.refreshToken,
        scope: oldToken.scope,
      });
    }
    res
      .status(400)
      .json({ code: 'invalid_request', error: 'invalid grant type' });
  },
);

export { authRouter };
