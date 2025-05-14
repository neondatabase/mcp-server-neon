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
  extractClientCredentials,
  generateRandomString,
  parseAuthRequest,
  toMilliseconds,
  toSeconds,
  verifyPKCE,
} from './utils.js';
import { exchangeCode, exchangeRefreshToken, upstreamAuth } from './client.js';
import { createNeonClient } from '../server/api.js';
import bodyParser from 'body-parser';
import { SERVER_HOST, COOKIE_SECRET } from '../constants.js';
import {
  isClientAlreadyApproved,
  updateApprovedClientsCookie,
} from './cookies.js';
import { identify } from '../analytics/analytics.js';

const SUPPORTED_GRANT_TYPES = ['authorization_code', 'refresh_token'];
const SUPPORTED_RESPONSE_TYPES = ['code'];
const SUPPORTED_AUTH_METHODS = [
  'client_secret_post',
  'client_secret_basic',
  'none',
];
const SUPPORTED_CODE_CHALLENGE_METHODS = ['S256'];
export const metadata = (req: ExpressRequest, res: ExpressResponse) => {
  res.json({
    issuer: SERVER_HOST,
    authorization_endpoint: `${SERVER_HOST}/authorize`,
    token_endpoint: `${SERVER_HOST}/token`,
    registration_endpoint: `${SERVER_HOST}/register`,
    response_types_supported: SUPPORTED_RESPONSE_TYPES,
    response_modes_supported: ['query'],
    grant_types_supported: SUPPORTED_GRANT_TYPES,
    token_endpoint_auth_methods_supported: SUPPORTED_AUTH_METHODS,
    registration_endpoint_auth_methods_supported: SUPPORTED_AUTH_METHODS,
    code_challenge_methods_supported: SUPPORTED_CODE_CHALLENGE_METHODS,
  });
};

export const registerClient = async (
  req: ExpressRequest,
  res: ExpressResponse,
) => {
  const payload = req.body;
  logger.info('request to register client: ', {
    name: payload.client_name,
    client_uri: payload.client_uri,
  });

  if (payload.client_name === undefined) {
    res
      .status(400)
      .json({ code: 'invalid_request', error: 'client_name is required' });
    return;
  }

  if (payload.redirect_uris === undefined) {
    res
      .status(400)
      .json({ code: 'invalid_request', error: 'redirect_uris is required' });
    return;
  }

  if (
    payload.grant_types === undefined ||
    !payload.grant_types.every((grant: string) =>
      SUPPORTED_GRANT_TYPES.includes(grant),
    )
  ) {
    res.status(400).json({
      code: 'invalid_request',
      error:
        'grant_types is required and must only include supported grant types',
    });
    return;
  }

  if (
    payload.response_types === undefined ||
    !payload.response_types.every((responseType: string) =>
      SUPPORTED_RESPONSE_TYPES.includes(responseType),
    )
  ) {
    res.status(400).json({
      code: 'invalid_request',
      error:
        'response_types is required and must only include supported response types',
    });
    return;
  }

  try {
    const clientId = generateRandomString(8);
    const clientSecret = generateRandomString(32);
    const client: Client = {
      ...payload,
      id: clientId,
      secret: clientSecret,
      tokenEndpointAuthMethod:
        (req.body.token_endpoint_auth_method as string) ?? 'client_secret_post',
      registrationDate: Math.floor(Date.now() / 1000),
    };

    await model.saveClient(client);
    logger.info('new client registered', {
      clientId,
      client_name: payload.client_name,
      redirect_uris: payload.redirect_uris,
      client_uri: payload.client_uri,
    });

    res.json({
      client_id: clientId,
      client_secret: clientSecret,
      client_name: payload.client_name,
      redirect_uris: payload.redirect_uris,
      token_endpoint_auth_method: client.tokenEndpointAuthMethod,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('failed to register client:', {
      message,
      error,
      client: payload.client_name,
      client_uri: payload.client_uri,
    });
    res.status(500).json({ code: 'server_error', error, message });
  }
};

const authRouter = express.Router();
authRouter.get('/.well-known/oauth-authorization-server', metadata);
authRouter.post('/register', bodyParser.json(), registerClient);

/*
  Initiate the authorization code grant flow by validating the request parameters and then redirecting to the upstream authorization server.
  
  Step 1:
  MCP client should invoke this endpoint with the following parameters:
  <code>
    /authorize?client_id=clientId&redirect_uri=mcp://callback&response_type=code&scope=scope&code_challenge=codeChallenge&code_challenge_method=S256
  </code>

  This endpoint will validate the `client_id` and other request parameters and then capture the parameters on `state` param and redirect to the upstream authorization server.
*/
authRouter.get(
  '/authorize',
  bodyParser.urlencoded({ extended: true }),
  async (req: ExpressRequest, res: ExpressResponse) => {
    const requestParams = parseAuthRequest(req);

    const clientId = requestParams.clientId;
    const client = await model.getClient(clientId, '');
    if (!client) {
      res
        .status(400)
        .json({ code: 'invalid_request', error: 'invalid client id' });
      return;
    }

    if (
      requestParams.responseType == undefined ||
      !client.response_types.includes(requestParams.responseType)
    ) {
      res
        .status(400)
        .json({ code: 'invalid_request', error: 'invalid response type' });
      return;
    }

    if (
      requestParams.redirectUri == undefined ||
      !client.redirect_uris.includes(requestParams.redirectUri)
    ) {
      res
        .status(400)
        .json({ code: 'invalid_request', error: 'invalid redirect uri' });
      return;
    }

    if (await isClientAlreadyApproved(req, client.id, COOKIE_SECRET)) {
      const authUrl = await upstreamAuth(btoa(JSON.stringify(requestParams)));
      res.redirect(authUrl.href);
      return;
    }

    res.render('approval-dialog', {
      client,
      state: btoa(JSON.stringify(requestParams)),
    });
  },
);

authRouter.post(
  '/authorize',
  bodyParser.urlencoded({ extended: true }),
  async (req: ExpressRequest, res: ExpressResponse) => {
    const state = req.body.state as string;
    if (!state) {
      res.status(400).json({ code: 'invalid_request', error: 'invalid state' });
      return;
    }

    const requestParams = JSON.parse(atob(state));
    await updateApprovedClientsCookie(
      req,
      res,
      requestParams.clientId,
      COOKIE_SECRET,
    );
    const authUrl = await upstreamAuth(state);
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
    const nonce = generateRandomString(32);
    const authCode = `${grantId}:${nonce}`;

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
      code_challenge: requestParams.codeChallenge,
      code_challenge_method: requestParams.codeChallengeMethod,
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
    const { clientId, clientSecret } = extractClientCredentials(req);
    if (!clientId) {
      res
        .status(400)
        .json({ code: 'invalid_request', error: 'client_id is required' });
      return;
    }

    const error = {
      error: 'invalid_client',
      error_description: 'client not found or invalid client credentials',
    };
    const client = await model.getClient(clientId, '');
    if (!client) {
      res.status(400).json({ code: 'invalid_request', ...error });
      return;
    }

    const isPublicClient = client.tokenEndpointAuthMethod === 'none';
    if (!isPublicClient) {
      if (clientSecret !== client.secret) {
        res.status(400).json({ code: 'invalid_request', ...error });
        return;
      }
    }

    const formData = req.body;
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

      const isPkceEnabled = authorizationCode.code_challenge !== undefined;
      if (
        isPkceEnabled &&
        !verifyPKCE(
          authorizationCode.code_challenge,
          authorizationCode.code_challenge_method,
          formData.code_verifier,
        )
      ) {
        res.status(400).json({
          code: 'invalid_grant',
          error: 'invalid PKCE code verifier',
        });
        return;
      }
      if (!isPkceEnabled && !formData.redirect_uri) {
        res.status(400).json({
          code: 'invalid_request',
          error: 'redirect_uri is required when not using PKCE',
        });
        return;
      }
      if (
        formData.redirect_uri &&
        !client.redirect_uris.includes(formData.redirect_uri)
      ) {
        res.status(400).json({
          code: 'invalid_request',
          error: 'invalid redirect uri',
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

      identify({
        userId: authorizationCode.user.id,
        traits: {
          name: authorizationCode.user.name,
          email: authorizationCode.user.email,
        },
        context: {
          client: {
            id: client.id,
            name: client.client_name,
          },
        },
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
        // Refresh token is missing its counter access token, delete it
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
        refreshToken: token.refreshToken ?? '',
        accessToken: token.accessToken,
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
      return;
    }
    res
      .status(400)
      .json({ code: 'invalid_request', error: 'invalid grant type' });
  },
);

export { authRouter };
