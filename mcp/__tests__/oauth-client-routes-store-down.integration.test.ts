/**
 * /api/revoke when the OAuth database refuses connections: the client gets
 * the OAuth `server_error` 500, the route span fails, and Sentry gets one
 * event naming the store operation.
 */
import { once } from 'node:events';
import { flush, init, startSpan } from '@sentry/node';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

process.env.E2E_SENTRY_PORT = '3116';

process.env.OAUTH_DATABASE_URL = 'postgresql://127.0.0.1:1/oauth';

const {
  SENTRY_FIXTURE_DSN,
  SENTRY_FIXTURE_ITEMS_URL,
  startSentryFixtureServer,
} = await import('../../e2e/sentry-fixture');

const { app } = await import('../../lib/http/app');

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

init({ dsn: SENTRY_FIXTURE_DSN, tracesSampleRate: 1 });

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

const routeSpan = async (name: string, description: string) => {
  const payloads = await items('transaction');

  return payloads
    .map((payload) => Transaction.parse(payload))
    .find((transaction) => transaction.transaction === name)
    ?.spans.find((span) => span.description === description);
};

describe('POST /api/revoke with the store down', () => {
  afterAll(async () => {
    fixture.close();
    await once(fixture, 'close');
  });

  it('answers 500 and reports the failed client lookup', async () => {
    const before = await errorEvents();

    const response = await startSpan(
      { name: 'revoke store down', op: 'http.server' },
      async () =>
        app.handler(
          new Request('http://localhost/api/revoke', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: 'some-client',
              token: 'anything',
            }).toString(),
          }),
        ),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toStrictEqual({
      error: 'server_error',
      error_description: 'Internal server error',
    });
    await expect(
      routeSpan('revoke store down', 'OAuthRevoke.revoke'),
    ).resolves.toStrictEqual({
      description: 'OAuthRevoke.revoke',
      status: 'internal_error',
    });

    const after = await errorEvents();
    const reported = after.slice(before.length);

    expect(reported).toHaveLength(1);
    expect(reported[0]?.exception.values).toContainEqual({
      type: 'OAuthStoreUnavailable',
      value: 'OAuth store getClient failed',
    });
  }, 30_000);
});
