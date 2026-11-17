/**
 * A fetch that times out reaches Sentry with the code that set the timer: a
 * real fetch against a local server that never answers, and the real Sentry
 * SDK, sending to the e2e Sentry stand-in.
 */
import { once } from 'node:events';
import { createServer } from 'node:http';
import { captureException, flush, init } from '@sentry/node';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

process.env.E2E_SENTRY_PORT = '3114';

const {
  SENTRY_FIXTURE_DSN,
  SENTRY_FIXTURE_ITEMS_URL,
  startSentryFixtureServer,
} = await import('../../e2e/sentry-fixture');

const { recordTimeoutOrigins } = await import('../sentry/timeout-origin');

const sentry = await startSentryFixtureServer();

init({ dsn: SENTRY_FIXTURE_DSN });

recordTimeoutOrigins();

// Reads each request and never answers, so every fetch runs into its deadline.
const silent = createServer((req) => {
  req.resume();
});

silent.listen(0, '127.0.0.1');

await once(silent, 'listening');

const silentUrl = `http://127.0.0.1:${z.object({ port: z.number() }).parse(silent.address()).port}`;

const fetchWithDeadline = async (signal: AbortSignal) =>
  fetch(silentUrl, { signal });

const ExceptionValue = z.object({
  type: z.string(),
  value: z.string(),
  // The TimeoutError itself has no stack worth sending; its origin does.
  stacktrace: z
    .object({
      frames: z.array(z.object({ function: z.string().optional() })),
    })
    .default({ frames: [] }),
});

const Event = z.object({
  exception: z.object({ values: z.array(ExceptionValue) }),
});

const sentExceptions = async () => {
  await flush(5000);

  const response = await fetch(SENTRY_FIXTURE_ITEMS_URL);

  const items = z
    .array(z.object({ type: z.string(), payload: z.unknown() }))
    .parse(await response.json());

  return items
    .filter((item) => item.type === 'event')
    .flatMap((item) => Event.parse(item.payload).exception.values);
};

const ORIGIN = 'AbortSignal.timeout(50) was created here';

describe('AbortSignal.timeout origin', () => {
  afterAll(() => {
    silent.closeAllConnections();
    silent.close();
    sentry.close();
  });

  it('gives a timed-out fetch a cause that names where the timer was set', async () => {
    await expect(
      fetchWithDeadline(AbortSignal.timeout(50)),
    ).rejects.toMatchObject({
      name: 'TimeoutError',
      cause: { message: ORIGIN },
    });
  });

  it('keeps the cause through AbortSignal.any', async () => {
    await expect(
      fetchWithDeadline(
        AbortSignal.any([
          new AbortController().signal,
          AbortSignal.timeout(50),
        ]),
      ),
    ).rejects.toMatchObject({
      name: 'TimeoutError',
      cause: { message: ORIGIN },
    });
  });

  it('reports the origin to Sentry as a linked error with its stack', async () => {
    // Named so the test can find it among the linked error's frames.
    const createsTimeout = async () =>
      fetchWithDeadline(AbortSignal.timeout(50));

    await createsTimeout().catch(captureException);

    const exceptions = await sentExceptions();

    const originFrames = exceptions
      .filter((exception) => exception.value === ORIGIN)
      .flatMap((exception) =>
        exception.stacktrace.frames.map((frame) => frame.function),
      );

    expect(exceptions.map((exception) => exception.type)).toContain(
      'TimeoutError',
    );
    expect(originFrames).toContain('createsTimeout');
  });
});
