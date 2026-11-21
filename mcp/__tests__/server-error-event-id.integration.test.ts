/**
 * `server_error` analytics events carry the id they ask Sentry to use, so a
 * row in the lake joins to its Sentry issue. Real Sentry SDK, sending to the
 * e2e Sentry stand-in.
 */
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { flush, init } from '@sentry/node';
import { Effect } from 'effect';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

process.env.E2E_SENTRY_PORT = '3121';

const {
  SENTRY_FIXTURE_DSN,
  SENTRY_FIXTURE_ITEMS_URL,
  startSentryFixtureServer,
} = await import('../../e2e/sentry-fixture');

const { SentryLayer, reportServerFailure } = await import('../sentry/effect');

const Items = z.array(z.object({ type: z.string(), payload: z.unknown() }));

const ErrorEvent = z.object({
  event_id: z.string(),
  exception: z.object({ values: z.array(z.object({ value: z.string() })) }),
});

const fixture = await startSentryFixtureServer();

init({ dsn: SENTRY_FIXTURE_DSN });

describe('reportServerFailure', () => {
  afterAll(async () => {
    fixture.close();
    await once(fixture, 'close');
  });

  it('sends the event under the event id it was given', async () => {
    const eventId = randomUUID().replaceAll('-', '');

    await Effect.runPromise(
      reportServerFailure(new Error('server-error-canary'), {
        event_id: eventId,
        captureContext: { tags: { client_application: 'cursor' } },
      }).pipe(Effect.provide(SentryLayer)),
    );
    await flush(5000);

    const response = await fetch(SENTRY_FIXTURE_ITEMS_URL);

    const events = Items.parse(await response.json())
      .filter((item) => item.type === 'event')
      .map((item) => ErrorEvent.parse(item.payload))
      .filter((event) =>
        event.exception.values.some(
          ({ value }) => value === 'server-error-canary',
        ),
      );

    expect(events.map((event) => event.event_id)).toStrictEqual([eventId]);
  }, 30_000);
});
