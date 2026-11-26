/**
 * A request the MCP transport rejects, such as a body that is not JSON or not
 * a JSON-RPC message, is answered with a JSON-RPC error and is not a server
 * failure: it reaches no Sentry error event. Each case is a stateless
 * `POST /mcp` through the deployed route handler, against a local Neon API for
 * API-key auth and the e2e Sentry stand-in.
 */
import { createServer } from 'node:http';
import { once } from 'node:events';
import { flush, init } from '@sentry/node';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const API_ROUTES = new Map<string, string>([
  [
    '/auth',
    JSON.stringify({
      auth_method: 'api_key_user',
      account_id: 'user_test_123',
    }),
  ],
  [
    '/users/me',
    JSON.stringify({
      id: 'user_test_123',
      name: 'Test User',
      email: 'test@example.com',
    }),
  ],
  ['/users/me/organizations', JSON.stringify({ organizations: [] })],
]);

const api = createServer((req, res) => {
  const [path = ''] = (req.url ?? '').replace(/^\/api\/v2/u, '').split('?');
  const route = API_ROUTES.get(path);

  res.writeHead(route === undefined ? 404 : 200, {
    'content-type': 'application/json',
  });
  res.end(route ?? JSON.stringify({ message: `no fake for ${path}` }));
});

api.listen(0, '127.0.0.1');

await once(api, 'listening');

const apiPort = z.object({ port: z.number() }).parse(api.address()).port;

process.env.NEON_API_HOST = `http://127.0.0.1:${apiPort}/api/v2`;

process.env.ANALYTICS_WRITE_KEY = '';

process.env.SENTRY_DSN = '';

process.env.E2E_SENTRY_PORT = '3125';

// The route reads OAuth tokens and the API-key cache before verifying a key.
// A closed port makes those reads fail at once, as the route tolerates.
process.env.OAUTH_DATABASE_URL = 'postgresql://127.0.0.1:1/malformed';

const {
  SENTRY_FIXTURE_DSN,
  SENTRY_FIXTURE_ITEMS_URL,
  startSentryFixtureServer,
} = await import('../../e2e/sentry-fixture');

const { POST } = await import('../../app/api/[transport]/route');

const { SERVER_HOST } = await import('../../lib/config');

const sentry = await startSentryFixtureServer();

init({ dsn: SENTRY_FIXTURE_DSN });

const ENDPOINTS = {
  authenticated: { query: '', authorization: 'Bearer test-api-key' },
  'docs-only': { query: '?category=docs', authorization: undefined },
} as const;

type Endpoint = (typeof ENDPOINTS)[keyof typeof ENDPOINTS];

const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

const post = async (
  endpoint: Endpoint,
  body: string,
  headers: Record<string, string> = MCP_HEADERS,
) => {
  const requestHeaders = new Headers(headers);

  if (endpoint.authorization !== undefined) {
    requestHeaders.set('authorization', endpoint.authorization);
  }

  return POST(
    new Request(`${SERVER_HOST}/mcp${endpoint.query}`, {
      method: 'POST',
      headers: requestHeaders,
      body,
    }),
  );
};

const toolsList = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/list',
});

type Case = {
  body: string;
  headers?: Record<string, string>;
  status: number;
  code: number;
};

const PARSE_ERROR = -32_700;
const INVALID_REQUEST = -32_600;
const TRANSPORT_ERROR = -32_000;

const CASES = {
  'a body that is not JSON': {
    body: '<html></html>',
    status: 400,
    code: PARSE_ERROR,
  },
  'truncated JSON': {
    body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"',
    status: 400,
    code: PARSE_ERROR,
  },
  'an empty body': { body: '', status: 400, code: PARSE_ERROR },
  'a request with null params': {
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: null,
    }),
    status: 400,
    code: INVALID_REQUEST,
  },
  'a JSON value that is not a message': {
    body: '42',
    status: 400,
    code: INVALID_REQUEST,
  },
  'an empty batch': { body: '[]', status: 400, code: INVALID_REQUEST },
  'a batch with an invalid message': {
    body: JSON.stringify([
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: null },
    ]),
    status: 400,
    code: INVALID_REQUEST,
  },
  'a 2025-era request without text/event-stream in Accept': {
    body: toolsList,
    headers: { ...MCP_HEADERS, accept: 'application/json' },
    status: 406,
    code: TRANSPORT_ERROR,
  },
  'a 2025-era request with an unsupported protocol version': {
    body: toolsList,
    headers: { ...MCP_HEADERS, 'mcp-protocol-version': '2024-01-01' },
    status: 400,
    code: TRANSPORT_ERROR,
  },
} satisfies Record<string, Case>;

const SentryEvent = z.object({
  exception: z.object({ values: z.array(z.object({ value: z.string() })) }),
});

const sentryErrorMessages = async () => {
  await flush(5000);

  const fetched = await fetch(SENTRY_FIXTURE_ITEMS_URL);

  const items = z
    .array(z.object({ type: z.string(), payload: z.unknown() }))
    .parse(await fetched.json());

  return items
    .filter(({ type }) => type === 'event')
    .flatMap(({ payload }) =>
      SentryEvent.parse(payload).exception.values.map(({ value }) => value),
    );
};

let controls = 0;

/**
 * A posted JSON-RPC response for an id the server never sent is answered 202
 * and reported as a protocol error behind a 2xx, so it reaches Sentry. Its
 * event arrives after any event the case before it produced, which makes it
 * the point at which the case's events can be counted.
 */
const sendControl = async () => {
  controls += 1;

  const id = `control-${controls}`;

  const response = await post(
    ENDPOINTS.authenticated,
    JSON.stringify({ jsonrpc: '2.0', id, result: {} }),
  );

  expect(response.status).toBe(202);

  return id;
};

describe('malformed MCP messages', () => {
  afterAll(() => {
    api.close();
    sentry.close();
  });

  describe.each(Object.entries(ENDPOINTS))(
    'on the %s endpoint',
    (_endpointName, endpoint) => {
      it.each(Object.entries(CASES))(
        'answers %s with a JSON-RPC error and no Sentry event',
        async (_caseName, testCase: Case) => {
          const earlier = await sentryErrorMessages();

          const response = await post(
            endpoint,
            testCase.body,
            testCase.headers,
          );

          expect(response.status).toBe(testCase.status);
          await expect(response.json()).resolves.toMatchObject({
            jsonrpc: '2.0',
            error: { code: testCase.code },
          });

          const control = await sendControl();

          const reported = await vi.waitFor(
            async () => {
              const messages = await sentryErrorMessages();
              const since = messages.slice(earlier.length);

              expect(since.some((message) => message.includes(control))).toBe(
                true,
              );

              return since;
            },
            { timeout: 10_000, interval: 100 },
          );

          expect(
            reported.filter((message) => !message.includes(control)),
          ).toStrictEqual([]);
        },
      );
    },
  );
});
