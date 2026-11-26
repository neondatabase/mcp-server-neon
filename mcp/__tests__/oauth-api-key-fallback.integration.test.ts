/**
 * An OAuth bearer or API key on the MCP transport while the token store is
 * down: `OAUTH_DATABASE_URL` refuses connections, so the token lookup and the
 * API-key cache fail for real, and a loopback Neon API verifies each bearer.
 * `oauth-api-key-fallback-store-answers.integration.test.ts` covers the store
 * answering.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { collectKeepalives, serveLoopback } from './helpers/loopback';
import {
  listedToolNames,
  mcpRequest,
  responseBody,
} from './helpers/mcp-request';
import { neonAuthStandIn } from './helpers/neon-auth';

const neon = neonAuthStandIn();
const upstream = await serveLoopback(neon.answer);
const keepalives = collectKeepalives();

Object.assign(process.env, {
  NEON_API_HOST: `${upstream.origin}/api/v2`,
  NEON_MCP_DISABLE_ANALYTICS: '1',
  SENTRY_DSN: '',
  OAUTH_DATABASE_URL: 'postgresql://127.0.0.1:1/api-key-fallback',
});

const { POST, GET, HEAD } = await import('../../app/api/[transport]/route');
const { logger } = await import('../utils/logger');

const logged: string[] = [];

logger.on('data', (info: { readonly message: string }) => {
  logged.push(info.message);
});

const uniqueId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

/** A bearer the Neon API reports with `authMethod`. */
const bearerFor = (
  authMethod: 'oauth' | 'api_key_user' | 'api_key_org',
  user: 'answers' | 'fails' = 'answers',
) => {
  const bearer = uniqueId(authMethod === 'oauth' ? 'oauth-bearer' : 'napi');

  neon.callers.set(bearer, { authMethod, accountId: uniqueId('acct'), user });

  return bearer;
};

const request = (method: string, path: string, bearer: string) =>
  new Request(`http://localhost${path}`, {
    method,
    headers: { Authorization: `Bearer ${bearer}` },
  });

const listTools = async (bearerToken: string, queryString = '') => {
  const res = await POST(
    mcpRequest({ method: 'tools/list', bearerToken, queryString }),
  );

  const body = responseBody(await res.text());

  await keepalives.settle();

  return { res, body };
};

const expectTokenStoreUnavailable = (res: Response) => {
  expect(res.status).toBe(503);
  expect(res.headers.get('Retry-After')).toBe('5');
  expect(res.headers.get('WWW-Authenticate')).toBeNull();
};

describe('OAuth bearer on the API-key path while the token store is down', () => {
  beforeEach(() => {
    logged.length = 0;
  });

  it('answers 503 instead of a URL grant when the token store lookup fails', async () => {
    const { res, body } = await listTools(bearerFor('oauth'));

    expectTokenStoreUnavailable(res);
    expect(body).toStrictEqual({
      error: 'Token store unavailable',
      code: 'token_store_unavailable',
    });
  });

  it('answers 503 even when resolving the account would fail', async () => {
    const bearer = bearerFor('oauth', 'fails');

    const { res } = await listTools(bearer);

    expectTokenStoreUnavailable(res);
    expect(neon.requestedWith(bearer)).toStrictEqual(['/auth']);
    // A cache write would reach the unreachable store and log its failure.
    expect(logged).not.toContain('API key cache write failed');
    expect(logged).not.toContain('API key cache miss, verified and cached');
  });

  // An authenticated route answers 503 for this bearer while the store is down.
  it.each(['/sse', '/api/sse'])(
    'retires GET %s without consulting authentication',
    async (path) => {
      const bearer = bearerFor('oauth');

      const res = await GET(request('GET', path, bearer));

      expect(res.status).toBe(410);
      expect(res.headers.get('Content-Type')).toBe('application/json');
      await expect(res.json()).resolves.toMatchObject({
        error: 'transport_gone',
      });
      expect(neon.requestedWith(bearer)).toStrictEqual([]);
    },
  );

  it('retires an SSE message POST without consulting authentication', async () => {
    const bearer = bearerFor('oauth');

    const res = await POST(
      new Request('http://localhost/api/message?sessionId=session-1', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bearer}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    );

    expect(res.status).toBe(410);
    await expect(res.json()).resolves.toMatchObject({
      error: 'transport_gone',
    });
    expect(neon.requestedWith(bearer)).toStrictEqual([]);
  });

  it.each(['/mcp', '/api/mcp'])(
    'answers HEAD %s with an empty 503 when the store is down',
    async (path) => {
      const unavailable = await HEAD(request('HEAD', path, bearerFor('oauth')));

      expectTokenStoreUnavailable(unavailable);
      await expect(unavailable.text()).resolves.toBe('');
    },
  );

  it.each(['api_key_user', 'api_key_org'] as const)(
    'keeps %s working with its URL grant while the token store is down',
    async (authMethod) => {
      const { res, body } = await listTools(
        bearerFor(authMethod),
        '?readonly=true&category=querying',
      );

      expect(res.status).toBe(200);
      expect(listedToolNames(body)).toContain('run_sql');
      expect(listedToolNames(body)).not.toContain('run_sql_transaction');
      expect(listedToolNames(body)).not.toContain('list_projects');
    },
  );

  it('keeps an API key working when the API-key cache is down too', async () => {
    const apiKey = bearerFor('api_key_user');

    const { res, body } = await listTools(apiKey);

    expect(res.status).toBe(200);
    expect(listedToolNames(body)).toContain('create_project');
    expect(logged).toContain('API key cache read failed');
  });
});
