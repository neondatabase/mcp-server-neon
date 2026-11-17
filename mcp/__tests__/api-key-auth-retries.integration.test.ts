/**
 * An API key whose verification loses its connection to the Neon API. Each
 * case is a stateless `POST /mcp` through the deployed route handler against a
 * local Neon API that drops the first requests it is told to.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { once } from 'node:events';
import { getClient, init, spanToJSON } from '@sentry/node';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const authRequests = new Map<string, number>();

// How many `/auth` requests each key has dropped before Neon answers.
const DROPPED_AUTH_REQUESTS = new Map<string, number>([
  ['key-flaky', 1],
  ['key-down', Number.POSITIVE_INFINITY],
]);

const json = (res: ServerResponse, status: number, body: Json) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

// `/auth` for `key-hang` is held open, to abort the client request mid-check.
const hangingAuth = {
  reached: Promise.withResolvers<true>(),
  closed: Promise.withResolvers<true>(),
};

const answerApi = (req: IncomingMessage, res: ServerResponse) => {
  const [path = ''] = (req.url ?? '').replace(/^\/api\/v2/u, '').split('?');
  const key = (req.headers.authorization ?? '').replace(/^Bearer /u, '');

  if (path === '/auth' && key === 'key-hang') {
    hangingAuth.reached.resolve(true);
    req.on('close', () => {
      hangingAuth.closed.resolve(true);
    });

    return;
  }

  if (path === '/auth' && key === 'key-rejected') {
    json(res, 401, { message: 'authentication failed' });

    return;
  }

  if (path === '/auth') {
    const count = (authRequests.get(key) ?? 0) + 1;

    authRequests.set(key, count);

    if (count <= (DROPPED_AUTH_REQUESTS.get(key) ?? 0)) {
      req.socket.destroy();

      return;
    }

    json(res, 200, { auth_method: 'api_key_user', account_id: 'user_1' });

    return;
  }

  if (path === '/users/me') {
    json(res, 200, { id: 'user_1', name: 'Test', email: 'test@example.com' });

    return;
  }

  json(res, 404, { message: `no fake for ${path}` });
};

const api = createServer(answerApi);

api.listen(0, '127.0.0.1');

await once(api, 'listening');

const { port } = z.object({ port: z.number() }).parse(api.address());

process.env.NEON_API_HOST = `http://127.0.0.1:${port}/api/v2`;

process.env.ANALYTICS_WRITE_KEY = '';

process.env.SENTRY_DSN = '';
// A closed port makes the route's OAuth token and API-key cache reads fail at
// once, as the route tolerates, so every request verifies its key with Neon.

process.env.OAUTH_DATABASE_URL = 'postgresql://127.0.0.1:1/api-key-retries';

init({ dsn: 'http://public@127.0.0.1:1/1', tracesSampleRate: 1 });

// Each McpAuth span's status by name, from the last request.
const authSpans = new Map<string, string>();

getClient()?.on('spanEnd', (span) => {
  const { description, status } = spanToJSON(span);

  if (description?.startsWith('McpAuth.') === true) {
    authSpans.set(description, status ?? 'unset');
  }
});

const { POST } = await import('../../app/api/[transport]/route');
const { SERVER_HOST } = await import('../../lib/config');

const listToolsRequest = (apiKey: string | undefined, signal?: AbortSignal) => {
  const headers = new Headers({
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-method': 'tools/list',
  });

  if (apiKey !== undefined) {
    headers.set('authorization', `Bearer ${apiKey}`);
  }

  return new Request(`${SERVER_HOST}/mcp`, {
    method: 'POST',
    signal,
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': {
            name: 'api-key-auth-retries',
            version: '1.0.0',
          },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  });
};

const listTools = async (apiKey: string | undefined) =>
  POST(listToolsRequest(apiKey));

describe('API key verification retries', () => {
  afterAll(() => {
    api.close();
  });

  it('verifies the key after a dropped connection', async () => {
    const response = await listTools('key-flaky');

    expect(response.status).toBe(200);
    expect(authRequests.get('key-flaky')).toBe(2);
  });

  it('answers 401 after two retries', async () => {
    const response = await listTools('key-down');

    expect(response.status).toBe(401);
    expect(authRequests.get('key-down')).toBe(3);
  });

  it('keeps the auth spans ok for a missing bearer', async () => {
    authSpans.clear();

    const response = await listTools(undefined);

    expect(response.status).toBe(401);
    expect(authSpans.get('McpAuth.authenticate')).toBe('ok');
  });

  it('keeps the auth spans ok for a key Neon rejects', async () => {
    authSpans.clear();

    const response = await listTools('key-rejected');

    expect(response.status).toBe(401);
    expect(authSpans.get('McpAuth.verifyApiKey')).toBe('ok');
    expect(authSpans.get('McpAuth.authenticate')).toBe('ok');
  });

  it('fails the auth spans when Neon cannot be reached', async () => {
    authSpans.clear();

    await listTools('key-down');

    expect(authSpans.get('McpAuth.verifyApiKey')).toBe('internal_error');
    expect(authSpans.get('McpAuth.authenticate')).toBe('internal_error');
  });

  it('closes the upstream auth check when the client aborts', async () => {
    const controller = new AbortController();
    const response = POST(listToolsRequest('key-hang', controller.signal));

    await hangingAuth.reached.promise;
    controller.abort();
    await response;

    await expect(hangingAuth.closed.promise).resolves.toBe(true);
  });
});
