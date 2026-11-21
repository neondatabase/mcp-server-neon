/**
 * An API key verified on a cache miss is cached by the write that runs after
 * the response, and the next request is served from that row. Stateless
 * `POST /mcp` through the deployed route against a local Neon API that counts
 * its calls and the real API-key table in the test OAuth database.
 */
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

const ACCOUNT_ID = 'user_api_key_cache';

const ROUTES = new Map<string, object>([
  ['/auth', { auth_method: 'api_key_user', account_id: ACCOUNT_ID }],
  [
    '/users/me',
    { id: ACCOUNT_ID, name: 'Cache User', email: 'cache@example.com' },
  ],
]);

const neonCalls: string[] = [];

const api = createServer((req, res) => {
  const [path = ''] = (req.url ?? '').replace(/^\/api\/v2/u, '').split('?');
  const route = ROUTES.get(path);

  neonCalls.push(path);
  res.writeHead(route === undefined ? 404 : 200, {
    'content-type': 'application/json',
  });
  res.end(JSON.stringify(route ?? { message: `no fake for ${path}` }));
});

api.listen(0, '127.0.0.1');

await once(api, 'listening');

const { port } = z.object({ port: z.number() }).parse(api.address());

process.env.NEON_API_HOST = `http://127.0.0.1:${String(port)}/api/v2`;

process.env.ANALYTICS_WRITE_KEY = '';

process.env.SENTRY_DSN = '';

const { ensureTestOauthDatabase } =
  await import('./ensure-test-oauth-database');

await ensureTestOauthDatabase();

const { POST } = await import('../../app/api/[transport]/route');

const { SERVER_HOST } = await import('../../lib/config');

const { getApiKeys } = await import('../oauth/kv-store');

// What `waitUntil` from @vercel/functions hands the platform, collected so the
// test can wait for the work that outlives the response.
const keepalives: Promise<unknown>[] = [];

const requestContext = Symbol.for('@vercel/request-context');

Object.defineProperty(globalThis, requestContext, {
  value: {
    get: () => ({
      waitUntil: (promise: Promise<unknown>) => keepalives.push(promise),
    }),
  },
  configurable: true,
});

const API_KEY = `napi_cache_${randomUUID()}`;

const listTools = async () => {
  const response = await POST(
    new Request(`${SERVER_HOST}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${API_KEY}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-method': 'tools/list',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': {
              name: 'api-key-cache',
              version: '1.0.0',
            },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    }),
  );

  return { status: response.status, body: await response.text() };
};

describe('API-key cache', () => {
  afterAll(async () => {
    Reflect.deleteProperty(globalThis, requestContext);
    await getApiKeys().delete(API_KEY);
    api.closeAllConnections();
    api.close();
  });

  it('verifies a key once with Neon and serves the next request from the row written after the response', async () => {
    const miss = await listTools();

    expect(miss.status).toBe(200);
    expect(miss.body).toContain('"tools"');
    expect(neonCalls).toStrictEqual(['/auth', '/users/me']);

    await Promise.all(keepalives);

    await expect(getApiKeys().get(API_KEY)).resolves.toStrictEqual({
      apiKey: API_KEY,
      authMethod: 'api_key_user',
      account: {
        id: ACCOUNT_ID,
        name: 'Cache User',
        email: 'cache@example.com',
        isOrg: false,
      },
    });

    const hit = await listTools();

    expect(hit).toStrictEqual(miss);
    expect(neonCalls).toStrictEqual(['/auth', '/users/me']);
  });
});
