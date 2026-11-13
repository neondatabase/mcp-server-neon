/**
 * Effect failures reach Sentry through `SentryLayer`: a real Effect router and
 * the real Sentry SDK, sending to the e2e Sentry stand-in.
 */
import { once } from 'node:events';
import { flush, init, startSpan } from '@sentry/node';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServer } from 'effect/http';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

process.env.E2E_SENTRY_PORT = '3112';

const {
  SENTRY_FIXTURE_DSN,
  SENTRY_FIXTURE_ITEMS_URL,
  startSentryFixtureServer,
} = await import('../../e2e/sentry-fixture');

const { SentryLayer } = await import('../sentry/effect');

const routes = HttpRouter.add(
  'GET',
  '/defect',
  Effect.die(new Error('effect-defect-canary')).pipe(
    Effect.withSpan('Test.defect'),
  ),
);

const app = HttpRouter.toWebHandler(
  Layer.merge(routes, SentryLayer).pipe(
    Layer.provide(HttpServer.layerServices),
  ),
  { disableLogger: true },
);

const Trace = z.object({ trace: z.object({ trace_id: z.string() }) });

const ErrorEvent = z.object({
  level: z.string(),
  contexts: Trace,
  exception: z.object({
    values: z.array(z.object({ type: z.string(), value: z.string() })),
  }),
});

const Transaction = z.object({
  transaction: z.string(),
  contexts: Trace,
  spans: z.array(z.object({ description: z.string(), status: z.string() })),
});

const Items = z.array(z.object({ type: z.string(), payload: z.unknown() }));

const payloads = async (type: string) => {
  await flush(5000);
  const response = await fetch(SENTRY_FIXTURE_ITEMS_URL);
  const items = Items.parse(await response.json());

  return items.filter((item) => item.type === type).map((item) => item.payload);
};

const errorEvents = async () => {
  const events = await payloads('event');

  return events.map((payload) => ErrorEvent.parse(payload));
};

const transactions = async () => {
  const traced = await payloads('transaction');

  return traced.map((payload) => Transaction.parse(payload));
};

const request = async (path: string) =>
  startSpan({ name: `GET ${path}`, op: 'http.server' }, async () =>
    app.handler(new Request(`http://localhost${path}`)),
  );

const fixture = await startSentryFixtureServer();

init({ dsn: SENTRY_FIXTURE_DSN, tracesSampleRate: 1 });

describe('SentryLayer', () => {
  afterAll(async () => {
    await app.dispose();
    fixture.close();
    await once(fixture, 'close');
  });

  it('captures a defect in the trace of the span it failed', async () => {
    const response = await request('/defect');

    expect(response.status).toBe(500);

    const events = await errorEvents();

    const event = events.find(({ exception }) =>
      exception.values.some(({ value }) => value === 'effect-defect-canary'),
    );

    const traced = await transactions();

    const transaction = traced.find(
      ({ transaction: name }) => name === 'GET /defect',
    );

    const span = transaction?.spans.find(
      ({ description }) => description === 'Test.defect',
    );

    expect(event?.level).toBe('error');
    expect(span?.status).toBe('internal_error');
    expect(event?.contexts.trace.trace_id).toBe(
      transaction?.contexts.trace.trace_id,
    );
  });

  it('skips unmatched routes', async () => {
    const before = await payloads('event');
    const missing = await request('/missing');

    expect(missing.status).toBe(404);
    await expect(payloads('event')).resolves.toStrictEqual(before);
  });
});
