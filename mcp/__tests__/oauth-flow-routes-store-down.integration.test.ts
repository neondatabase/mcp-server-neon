/**
 * /api/authorize and /callback when the OAuth database refuses connections:
 * the server's failure fails the route span and reaches Sentry exactly once,
 * and the client gets the OAuth error it always did.
 */
import { once } from 'node:events';
import { flush, httpIntegration, init, startSpan } from '@sentry/node';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

process.env.E2E_SENTRY_PORT = '3120';

process.env.OAUTH_DATABASE_URL = 'postgresql://127.0.0.1:1/oauth';

const {
  SENTRY_FIXTURE_DSN,
  SENTRY_FIXTURE_ITEMS_URL,
  startSentryFixtureServer,
} = await import('../../e2e/sentry-fixture');

const { app } = await import('../../lib/http/app');
const { SERVER_HOST } = await import('../../lib/config');

const Items = z.array(z.object({ type: z.string(), payload: z.unknown() }));

const ErrorEvent = z.object({
  exception: z.object({
    values: z.array(z.object({ type: z.string(), value: z.string() })),
  }),
});

const Transaction = z.object({
  transaction: z.string(),
  spans: z.array(z.object({ description: z.string(), status: z.string() })),
});

const fixture = await startSentryFixtureServer();

init({
  dsn: SENTRY_FIXTURE_DSN,
  tracesSampleRate: 1,
  integrations: [httpIntegration({ ignoreIncomingRequests: () => true })],
});

const items = async (type: string) => {
  await flush(5000);

  const response = await fetch(SENTRY_FIXTURE_ITEMS_URL);
  const body: unknown = await response.json();

  return Items.parse(body)
    .filter((item) => item.type === type)
    .map((item) => item.payload);
};

const errorEvents = async () => {
  const payloads = await items('event');

  return payloads.map((payload) => ErrorEvent.parse(payload));
};

const spanStatus = async (name: string, description: string) => {
  const payloads = await items('transaction');

  return payloads
    .map((payload) => Transaction.parse(payload))
    .find((transaction) => transaction.transaction === name)
    ?.spans.find((span) => span.description === description)?.status;
};

const get = async (
  name: string,
  path: string,
  headers: Record<string, string> = {},
) =>
  startSpan({ name, op: 'http.server' }, async () =>
    app.handler(new Request(new URL(path, SERVER_HOST), { headers })),
  );

const STATE = 'a'.repeat(32);
const SECRET = 'b'.repeat(64);

describe('OAuth browser flow routes with the store down', () => {
  afterAll(async () => {
    fixture.close();
    await once(fixture, 'close');
  });

  it('answers /api/authorize with server_error and reports the store failure', async () => {
    const earlier = await errorEvents();
    const before = earlier.length;

    const response = await get(
      'authorize store down',
      '/api/authorize?response_type=code&client_id=some-client&redirect_uri=http://127.0.0.1:5555/cb',
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toStrictEqual({
      error: 'server_error',
      error_description: 'Internal server error',
    });
    await expect(
      spanStatus('authorize store down', 'OAuthAuthorize.consent'),
    ).resolves.toBe('internal_error');

    const after = await errorEvents();
    const reported = after.slice(before);

    expect(reported).toHaveLength(1);
    expect(reported[0]?.exception.values).toContainEqual({
      type: 'OAuthStoreUnavailable',
      value: 'OAuth store getClient failed',
    });
  }, 30_000);

  it('answers /callback with server_error, retryable, and reports it once', async () => {
    const earlier = await errorEvents();
    const before = earlier.length;

    const response = await get(
      'callback store down',
      `/callback?code=c&state=${STATE}`,
      { cookie: `neon_mcp_at_${STATE}=${SECRET}` },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: 'server_error',
    });
    await expect(
      spanStatus('callback store down', 'OAuthCallback.callback'),
    ).resolves.toBe('internal_error');

    const after = await errorEvents();
    const reported = after.slice(before);

    expect(reported).toHaveLength(1);
    expect(reported[0]?.exception.values).toContainEqual({
      type: 'CallbackFailed',
      value: 'OAuth callback failed',
    });
  }, 30_000);

  it.each([
    { accept: 'application/json', type: 'application/json' },
    { accept: 'text/html', type: 'text/html' },
  ])(
    'answers a relayed upstream error ($accept) without a transaction and reports the store failure once',
    async ({ accept, type }) => {
      const earlier = await errorEvents();
      const before = earlier.length;

      const response = await get(
        `callback relay store down ${accept}`,
        `/callback?error=access_denied&error_description=denied&state=${STATE}`,
        { cookie: `neon_mcp_at_${STATE}=${SECRET}`, accept },
      );

      expect(response.status).toBe(400);
      expect(response.headers.get('content-type')).toContain(type);

      const after = await errorEvents();
      const reported = after.slice(before);

      expect(reported).toHaveLength(1);
      expect(reported[0]?.exception.values).toContainEqual({
        type: 'OAuthStoreUnavailable',
        value: 'OAuth store consumeBound failed',
      });
    },
    30_000,
  );
});
