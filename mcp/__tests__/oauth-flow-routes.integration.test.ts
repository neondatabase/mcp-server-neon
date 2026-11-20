/**
 * /api/authorize and /callback through the Effect app, against the real OAuth
 * Postgres database: the spans and Sentry events each answer leaves. A request
 * the caller got wrong keeps the route span ok and sends nothing to Sentry.
 */
import { once } from 'node:events';
import { flush, httpIntegration, init, startSpan } from '@sentry/node';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ensureTestOauthDatabase } from './ensure-test-oauth-database';

process.env.E2E_SENTRY_PORT = '3119';

const {
  SENTRY_FIXTURE_DSN,
  SENTRY_FIXTURE_ITEMS_URL,
  startSentryFixtureServer,
} = await import('../../e2e/sentry-fixture');

await ensureTestOauthDatabase();

const { app } = await import('../../lib/http/app');
const { SERVER_HOST } = await import('../../lib/config');

const Items = z.array(z.object({ type: z.string(), payload: z.unknown() }));

const Transaction = z.object({
  transaction: z.string(),
  spans: z.array(
    z.object({
      description: z.string(),
      status: z.string(),
      data: z.record(z.string(), z.unknown()),
    }),
  ),
});

const fixture = await startSentryFixtureServer();

// The fixture's own HTTP requests would otherwise become transactions too.
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

const errorEventCount = async () => {
  const events = await items('event');

  return events.length;
};

const routeSpan = async (name: string, description: string) => {
  const payloads = await items('transaction');

  const span = payloads
    .map((payload) => Transaction.parse(payload))
    .find((transaction) => transaction.transaction === name)
    ?.spans.find((candidate) => candidate.description === description);

  return span === undefined
    ? undefined
    : { status: span.status, errorType: span.data['error.type'] };
};

let requestCount = 0;

const get = async (path: string) => {
  requestCount += 1;

  const name = `GET ${path} #${requestCount}`;

  const response = await startSpan({ name, op: 'http.server' }, async () =>
    app.handler(new Request(new URL(path, SERVER_HOST))),
  );

  return { response, name };
};

describe('OAuth browser flow routes', () => {
  afterAll(async () => {
    fixture.close();
    await once(fixture, 'close');
  });

  it('answers an unknown client on /api/authorize with 400 and an ok span', async () => {
    const before = await errorEventCount();

    const { response, name } = await get(
      `/api/authorize?response_type=code&client_id=unknown-${crypto.randomUUID()}&redirect_uri=http://127.0.0.1:5555/cb`,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toStrictEqual({
      error: 'invalid_client',
      error_description: 'Invalid client ID',
    });
    await expect(
      routeSpan(name, 'OAuthAuthorize.consent'),
    ).resolves.toStrictEqual({ status: 'ok', errorType: undefined });
    await expect(errorEventCount()).resolves.toBe(before);
  });

  it('answers a bare /callback with 400 and an ok span', async () => {
    const before = await errorEventCount();
    const { response, name } = await get('/callback');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toStrictEqual({
      error: 'invalid_request',
      error_description: 'Missing code or state',
    });
    await expect(
      routeSpan(name, 'OAuthCallback.callback'),
    ).resolves.toStrictEqual({ status: 'ok', errorType: undefined });
    await expect(errorEventCount()).resolves.toBe(before);
  });

  it('asks to restart a /callback whose state is not a transaction', async () => {
    const before = await errorEventCount();
    const { response, name } = await get('/callback?code=c&state=not-a-tx');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'invalid_request',
    });
    await expect(
      routeSpan(name, 'OAuthCallback.callback'),
    ).resolves.toMatchObject({ status: 'ok' });
    await expect(errorEventCount()).resolves.toBe(before);
  });
});
