/**
 * One OAuth connection from registration to revocation, through the Effect
 * apps the route files forward to, with nothing replaced: the real OAuth
 * Postgres database, real openid-client discovery, code exchange, and ID-token
 * validation against a local HTTPS stand-in for Hydra, and a local Neon API
 * that only answers the access tokens that stand-in issued. Each step reads
 * what the previous one stored, so the pieces can't pass on their own while
 * broken together.
 */
import crypto from 'node:crypto';
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { text } from 'node:stream/consumers';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { selfSignedCertificate } from './helpers/self-signed-certificate';

const SERVER_HOST = 'https://mcp.lifecycle.test';
const UPSTREAM_CLIENT_ID = 'lifecycle-upstream-client';
const UPSTREAM_CLIENT_SECRET = 'lifecycle-upstream-secret';
const UPSTREAM_REDIRECT_URI = `${SERVER_HOST}/callback`;

// openid-client refuses a plain-HTTP issuer, and the stand-in's certificate
// is self-signed.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

process.env.SERVER_HOST = SERVER_HOST;

process.env.CLIENT_ID = UPSTREAM_CLIENT_ID;

process.env.CLIENT_SECRET = UPSTREAM_CLIENT_SECRET;

process.env.ANALYTICS_WRITE_KEY = '';

delete process.env.KV_URL;

delete process.env.REDIS_URL;

const USER = {
  id: 'lifecycle-user',
  name: 'Lifecycle',
  last_name: 'Test',
  email: 'lifecycle@example.com',
};

const ORGANIZATION = {
  id: 'org-lifecycle',
  name: 'Lifecycle Org',
  handle: 'lifecycle-org',
  plan: 'free_v3',
  managed_by: 'console',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const json = (response: ServerResponse, status: number, body: Json) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

const signing = await generateKeyPair('RS256');
const SIGNING_KEY_ID = 'lifecycle-key';
const publicJwk = await exportJWK(signing.publicKey);

/** What the Hydra stand-in issued and received. */
const upstream = {
  codes: new Map<string, { redirectUri: string; scope: string }>(),
  refreshTokens: new Map<string, { accessToken: string; scope: string }>(),
  liveAccessTokens: new Set<string>(),
  tokenRequests: new Array<URLSearchParams>(),
  tokenAnswers: new Array<Json>(),
};

const issuer = () =>
  `https://127.0.0.1:${z.object({ port: z.number() }).parse(hydra.address()).port}`;

const idToken = async () =>
  new SignJWT({ email: USER.email })
    .setProtectedHeader({ alg: 'RS256', kid: SIGNING_KEY_ID })
    .setIssuer(issuer())
    .setSubject(USER.id)
    .setAudience(UPSTREAM_CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(signing.privateKey);

const issueTokens = (scope: string) => {
  const accessToken = `hydra-at-${crypto.randomUUID()}`;
  const refreshToken = `hydra-rt-${crypto.randomUUID()}`;

  upstream.refreshTokens.set(refreshToken, { accessToken, scope });
  upstream.liveAccessTokens.add(accessToken);

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'bearer',
    expires_in: 3600,
    scope,
  };
};

// Hydra's login and consent happen elsewhere; the stand-in approves at once.
const upstreamAuthorize = (
  query: URLSearchParams,
  response: ServerResponse,
) => {
  const scope = query.get('scope') ?? '';

  if (
    query.get('client_id') !== UPSTREAM_CLIENT_ID ||
    query.get('redirect_uri') !== UPSTREAM_REDIRECT_URI ||
    query.get('response_type') !== 'code' ||
    !scope.split(' ').includes('openid')
  ) {
    json(response, 400, { error: 'invalid_request' });

    return;
  }

  const code = `hydra-code-${crypto.randomUUID()}`;

  upstream.codes.set(code, { redirectUri: UPSTREAM_REDIRECT_URI, scope });

  const redirect = new URL(UPSTREAM_REDIRECT_URI);

  redirect.searchParams.set('code', code);
  redirect.searchParams.set('scope', scope);
  redirect.searchParams.set('state', query.get('state') ?? '');

  response.writeHead(302, { location: redirect.href });
  response.end();
};

const upstreamTokenAnswer = async (
  form: URLSearchParams,
): Promise<{ readonly status: number; readonly body: Json }> => {
  if (
    form.get('client_id') !== UPSTREAM_CLIENT_ID ||
    form.get('client_secret') !== UPSTREAM_CLIENT_SECRET
  ) {
    return { status: 401, body: { error: 'invalid_client' } };
  }

  if (form.get('grant_type') === 'authorization_code') {
    const code = form.get('code') ?? '';
    const grant = upstream.codes.get(code);

    upstream.codes.delete(code);

    if (grant === undefined || form.get('redirect_uri') !== grant.redirectUri) {
      return { status: 400, body: { error: 'invalid_grant' } };
    }

    return {
      status: 200,
      body: { ...issueTokens(grant.scope), id_token: await idToken() },
    };
  }

  const refreshToken = form.get('refresh_token') ?? '';
  const issued = upstream.refreshTokens.get(refreshToken);

  if (form.get('grant_type') !== 'refresh_token' || issued === undefined) {
    return { status: 400, body: { error: 'invalid_grant' } };
  }

  upstream.refreshTokens.delete(refreshToken);
  upstream.liveAccessTokens.delete(issued.accessToken);

  return { status: 200, body: issueTokens(issued.scope) };
};

const upstreamToken = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  const form = new URLSearchParams(await text(request));
  const { status, body } = await upstreamTokenAnswer(form);

  upstream.tokenRequests.push(form);
  upstream.tokenAnswers.push(body);
  json(response, status, body);
};

const answerHydra = (request: IncomingMessage, response: ServerResponse) => {
  const url = new URL(request.url ?? '/', issuer());

  if (url.pathname === '/.well-known/openid-configuration') {
    json(response, 200, {
      issuer: issuer(),
      authorization_endpoint: `${issuer()}/oauth2/auth`,
      token_endpoint: `${issuer()}/oauth2/token`,
      jwks_uri: `${issuer()}/.well-known/jwks.json`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      token_endpoint_auth_methods_supported: ['client_secret_post'],
    });
  } else if (url.pathname === '/.well-known/jwks.json') {
    json(response, 200, {
      keys: [{ ...publicJwk, kid: SIGNING_KEY_ID, use: 'sig', alg: 'RS256' }],
    });
  } else if (url.pathname === '/oauth2/auth') {
    upstreamAuthorize(url.searchParams, response);
  } else if (url.pathname === '/oauth2/token') {
    void upstreamToken(request, response);
  } else {
    json(response, 404, { error: 'not_found' });
  }
};

const hydra = createHttpsServer(await selfSignedCertificate(), answerHydra);

const NEON_ANSWERS = new Map<string, Json>([
  ['/api/v2/auth', { auth_method: 'oauth', account_id: USER.id }],
  ['/api/v2/users/me', USER],
  ['/api/v2/users/me/organizations', { organizations: [ORGANIZATION] }],
]);

/** The bearer of every Neon API request, in order. */
const neonBearers: string[] = [];

const neonApi = createHttpServer((request, response) => {
  const bearer = request.headers.authorization?.replace(/^Bearer /u, '') ?? '';
  const answer = NEON_ANSWERS.get(request.url?.split('?')[0] ?? '');

  neonBearers.push(bearer);

  if (!upstream.liveAccessTokens.has(bearer)) {
    json(response, 401, { message: 'authentication required' });
  } else if (answer === undefined) {
    json(response, 404, { message: `no answer for ${request.url ?? ''}` });
  } else {
    json(response, 200, answer);
  }
});

hydra.listen(0, '127.0.0.1');

neonApi.listen(0, '127.0.0.1');

await Promise.all([once(hydra, 'listening'), once(neonApi, 'listening')]);

process.env.UPSTREAM_OAUTH_HOST = issuer();

process.env.NEON_API_HOST = `http://127.0.0.1:${z.object({ port: z.number() }).parse(neonApi.address()).port}/api/v2`;

// Imported once the environment above is set: lib/config reads it on load.
const { ensureTestOauthDatabase } =
  await import('./ensure-test-oauth-database');

await ensureTestOauthDatabase();

const { app } = await import('../../lib/http/app');
const { mcpApp } = await import('../../lib/http/mcp-app');
const { model } = await import('../oauth/model');
const { authTransactions } = await import('../oauth/auth-transaction-store');

const CLIENT_REDIRECT_URI = 'http://127.0.0.1:55667/callback';
const CLIENT_STATE = `client-state-${crypto.randomUUID()}`;
const CODE_VERIFIER = crypto.randomBytes(32).toString('base64url');

const CODE_CHALLENGE = crypto
  .createHash('sha256')
  .update(CODE_VERIFIER)
  .digest('base64url');

const APPROVED_GRANT = { projectId: null, scopes: ['querying', 'projects'] };

const Registration = z.object({
  client_id: z.string(),
  client_secret: z.string(),
});

const UpstreamTokens = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
});

const UpstreamSignIn = UpstreamTokens.extend({ id_token: z.string() });

const StoredExpiry = z.object({
  token: z.object({ access_token_expires_at: z.number() }),
});

const TokenPair = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  token_type: z.literal('bearer'),
  expires_in: z.number(),
  scope: z.string().optional(),
});

const RpcResult = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.number(),
  result: z.record(z.string(), z.unknown()),
});

const ToolResult = z.object({
  content: z.tuple([z.object({ type: z.literal('text'), text: z.string() })]),
  isError: z.boolean().optional(),
});

/** The `name=value` pairs a browser would send back. */
const cookiesOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';', 1)[0])
    .join('; ');

const locationOf = (response: Response) =>
  new URL(z.string().parse(response.headers.get('location')));

const formPost = async (
  path: string,
  fields: Record<string, string> | [string, string][],
  cookie?: string,
) => {
  const headers = new Headers({
    'content-type': 'application/x-www-form-urlencoded',
  });

  if (cookie !== undefined) {
    headers.set('cookie', cookie);
  }

  return app.handler(
    new Request(`${SERVER_HOST}${path}`, {
      method: 'POST',
      headers,
      body: new URLSearchParams(fields).toString(),
    }),
  );
};

const register = async () => {
  const response = await app.handler(
    new Request(`${SERVER_HOST}/api/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Lifecycle Test',
        redirect_uris: [CLIENT_REDIRECT_URI],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post',
      }),
    }),
  );

  expect(response.status).toBe(200);

  return Registration.parse(await response.json());
};

const authorize = async (clientId: string) => {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: CLIENT_REDIRECT_URI,
    scope: 'read write',
    state: CLIENT_STATE,
    code_challenge: CODE_CHALLENGE,
    code_challenge_method: 'S256',
    resource: `${SERVER_HOST}/mcp`,
  });

  return app.handler(
    new Request(`${SERVER_HOST}/api/authorize?${query.toString()}`),
  );
};

/** The JSON-RPC result of a JSON or event-stream MCP response. */
const rpcResultOf = async (response: Response) => {
  const body = await response.text();

  const data = body
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice('data: '.length))
    .at(-1);

  return RpcResult.parse(JSON.parse(data ?? body)).result;
};

const mcpRequest = async (accessToken: string, message: Record<string, Json>) =>
  mcpApp.handler(
    new Request(`${SERVER_HOST}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-11-25',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...message }),
    }),
  );

const LIST_ORGANIZATIONS = {
  method: 'tools/call',
  params: { name: 'list_organizations', arguments: {} },
};

const listOrganizations = async (accessToken: string) => {
  const response = await mcpRequest(accessToken, LIST_ORGANIZATIONS);

  expect(response.status).toBe(200);

  const result = ToolResult.parse(await rpcResultOf(response));

  expect(result.isError).not.toBe(true);

  const organizations: unknown = JSON.parse(result.content[0].text);

  return organizations;
};

describe('OAuth connection lifecycle', () => {
  afterAll(() => {
    hydra.close();
    neonApi.close();
  });

  it('registers, consents, signs in upstream, exchanges, calls a tool, refreshes, and revokes', async () => {
    const client = await register();
    const consent = await authorize(client.client_id);

    expect(consent.status).toBe(200);

    const transactionId = z
      .string()
      .parse(
        /<input type="hidden" name="state" value="(?<id>[0-9a-f]{32})"/u.exec(
          await consent.text(),
        )?.groups?.id,
      );

    expect(consent.headers.getSetCookie()).toStrictEqual([
      expect.stringMatching(
        new RegExp(
          `^__Host-neon_mcp_at_${transactionId}=[0-9a-f]{64}; Max-Age=\\d+; Path=/; HttpOnly; Secure; SameSite=Lax$`,
          'u',
        ),
      ),
    ]);

    const browserCookie = cookiesOf(consent);

    const approval = await formPost(
      '/api/authorize',
      [
        ['state', transactionId],
        ['action', 'approve'],
        ['projectMode', 'all'],
        ['category', 'querying'],
        ['category', 'projects'],
        ['scopes', 'read'],
        ['scopes', 'write'],
      ],
      browserCookie,
    );

    expect(approval.status).toBe(303);

    const upstreamAuthorization = locationOf(approval);

    expect(upstreamAuthorization.origin + upstreamAuthorization.pathname).toBe(
      `${issuer()}/oauth2/auth`,
    );
    expect(
      Object.fromEntries(upstreamAuthorization.searchParams),
    ).toMatchObject({
      client_id: UPSTREAM_CLIENT_ID,
      redirect_uri: UPSTREAM_REDIRECT_URI,
      response_type: 'code',
      state: transactionId,
    });
    await expect(
      authTransactions.getById(transactionId),
    ).resolves.toMatchObject({
      status: 'approved',
      approvedGrant: APPROVED_GRANT,
      approvedScopes: ['read', 'write'],
    });

    const upstreamLogin = await fetch(upstreamAuthorization, {
      redirect: 'manual',
    });

    expect(upstreamLogin.status).toBe(302);

    const callbackUrl = locationOf(upstreamLogin);

    expect(callbackUrl.origin + callbackUrl.pathname).toBe(
      UPSTREAM_REDIRECT_URI,
    );
    expect(callbackUrl.searchParams.get('state')).toBe(transactionId);

    const signInStartedAt = Date.now();

    const callback = await app.handler(
      new Request(callbackUrl, { headers: { cookie: browserCookie } }),
    );

    expect(callback.status).toBe(307);

    const clientRedirect = locationOf(callback);

    expect(clientRedirect.origin + clientRedirect.pathname).toBe(
      CLIENT_REDIRECT_URI,
    );
    expect(clientRedirect.searchParams.get('state')).toBe(CLIENT_STATE);
    expect(clientRedirect.searchParams.get('iss')).toBe(SERVER_HOST);
    expect(callback.headers.getSetCookie()).toStrictEqual([
      `__Host-neon_mcp_at_${transactionId}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
      `neon_mcp_at_${transactionId}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
    ]);
    await expect(
      authTransactions.getById(transactionId),
    ).resolves.toBeUndefined();

    const upstreamSignIn = UpstreamSignIn.parse(upstream.tokenAnswers.at(-1));
    const code = z.string().parse(clientRedirect.searchParams.get('code'));
    const storedCode = await model.getAuthorizationCode(code);

    expect(upstream.tokenRequests.at(-1)?.get('redirect_uri')).toBe(
      UPSTREAM_REDIRECT_URI,
    );
    expect(storedCode).toMatchObject({
      authorizationCode: code,
      redirectUri: CLIENT_REDIRECT_URI,
      scope: 'read write',
      client: { id: client.client_id },
      user: { id: USER.id, email: USER.email },
      code_challenge: CODE_CHALLENGE,
      code_challenge_method: 'S256',
      grant: APPROVED_GRANT,
      token: {
        access_token: upstreamSignIn.access_token,
        refresh_token: upstreamSignIn.refresh_token,
        id_token: upstreamSignIn.id_token,
      },
    });

    const expiresAt =
      StoredExpiry.parse(storedCode).token.access_token_expires_at;

    // openid-client counts expires_in down in whole seconds.
    expect(expiresAt).toBeGreaterThanOrEqual(signInStartedAt + 3_599_000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 3_600_000);

    const exchanged = await formPost('/api/token', {
      grant_type: 'authorization_code',
      code,
      redirect_uri: CLIENT_REDIRECT_URI,
      client_id: client.client_id,
      client_secret: client.client_secret,
      code_verifier: CODE_VERIFIER,
    });

    expect(exchanged.status).toBe(200);

    const pair = TokenPair.parse(await exchanged.json());

    expect(pair).toMatchObject({
      access_token: upstreamSignIn.access_token,
      refresh_token: upstreamSignIn.refresh_token,
      scope: 'read write',
    });
    await expect(model.getAuthorizationCode(code)).resolves.toBeUndefined();
    await expect(
      model.getAccessToken(pair.access_token),
    ).resolves.toMatchObject({
      accessToken: pair.access_token,
      refreshToken: pair.refresh_token,
      scope: 'read write',
      client: { id: client.client_id },
      user: { id: USER.id },
      grant: APPROVED_GRANT,
    });
    await expect(
      model.getRefreshToken(pair.refresh_token),
    ).resolves.toStrictEqual({
      refreshToken: pair.refresh_token,
      accessToken: pair.access_token,
    });

    const initialized = await mcpRequest(pair.access_token, {
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'oauth-lifecycle', version: '1.0.0' },
      },
    });

    expect(initialized.status).toBe(200);
    await expect(rpcResultOf(initialized)).resolves.toMatchObject({
      protocolVersion: '2025-11-25',
    });

    neonBearers.length = 0;

    await expect(listOrganizations(pair.access_token)).resolves.toStrictEqual([
      ORGANIZATION,
    ]);
    expect(new Set(neonBearers)).toStrictEqual(new Set([pair.access_token]));

    const refreshed = await formPost('/api/token', {
      grant_type: 'refresh_token',
      refresh_token: pair.refresh_token,
      client_id: client.client_id,
      client_secret: client.client_secret,
    });

    expect(refreshed.status).toBe(200);

    const rotated = TokenPair.parse(await refreshed.json());
    const upstreamRotation = UpstreamTokens.parse(upstream.tokenAnswers.at(-1));

    expect(upstream.tokenRequests.at(-1)?.get('refresh_token')).toBe(
      pair.refresh_token,
    );
    expect(rotated).toMatchObject(upstreamRotation);
    await expect(
      model.getRefreshToken(pair.refresh_token),
    ).resolves.toBeUndefined();
    await expect(
      model.getAccessToken(rotated.access_token),
    ).resolves.toMatchObject({
      refreshToken: rotated.refresh_token,
      client: { id: client.client_id },
      grant: APPROVED_GRANT,
    });
    await expect(
      listOrganizations(rotated.access_token),
    ).resolves.toStrictEqual([ORGANIZATION]);

    const revoked = await formPost('/api/revoke', {
      token: rotated.refresh_token,
      token_type_hint: 'refresh_token',
      client_id: client.client_id,
      client_secret: client.client_secret,
    });

    expect(revoked.status).toBe(200);
    await expect(
      model.getAccessToken(rotated.access_token),
    ).resolves.toBeUndefined();
    await expect(
      model.getRefreshToken(rotated.refresh_token),
    ).resolves.toBeUndefined();

    const afterRevoke = await mcpRequest(
      rotated.access_token,
      LIST_ORGANIZATIONS,
    );

    expect(afterRevoke.status).toBe(401);
    expect(afterRevoke.headers.get('www-authenticate')).toContain(
      'error="invalid_token"',
    );
  }, 60_000);
});
