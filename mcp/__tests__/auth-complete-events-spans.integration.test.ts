/**
 * The spans a `POST /api/auth-complete/events` beacon leaves in Sentry.
 */
import { getClient, init, spanToJSON } from '@sentry/node';
import { describe, expect, it } from 'vitest';

process.env.NEON_MCP_DISABLE_ANALYTICS = '1';

init({ dsn: 'http://public@127.0.0.1:1/1', tracesSampleRate: 1 });

const spans: { description: string | undefined; status: string | undefined }[] =
  [];

const trackedEvents: unknown[] = [];

getClient()?.on('spanEnd', (span) => {
  const { description, status, data } = spanToJSON(span);

  if (description?.startsWith('AuthCompleteEvents.') === true) {
    spans.push({ description, status });
  }

  if (description === 'Analytics.track') {
    trackedEvents.push(data['analytics.event']);
  }
});

const { POST } = await import('../../app/api/auth-complete/events/route');

const ORIGIN = 'http://localhost';

const beacon = async (body: string, origin: string) =>
  POST(
    new Request(`${ORIGIN}/api/auth-complete/events`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8', origin },
      body,
    }),
  );

const beaconWithoutBody = async () =>
  POST(
    new Request(`${ORIGIN}/api/auth-complete/events`, {
      method: 'POST',
      headers: { origin: ORIGIN },
    }),
  );

// Node's fetch needs `duplex` for a streamed body; the DOM type omits it.
const failingBodyInit: RequestInit & { duplex: 'half' } = {
  method: 'POST',
  headers: { origin: ORIGIN },
  body: new ReadableStream({
    start(controller) {
      controller.error(new Error('connection reset'));
    },
  }),
  duplex: 'half',
};

const beaconWithFailingBody = async () =>
  POST(new Request(`${ORIGIN}/api/auth-complete/events`, failingBodyInit));

const EVENT = JSON.stringify({
  pageViewId: '3f6a9a3e-2c1b-4d1e-9f5a-0b8c7d6e5f40',
  action: 'docs_clicked',
});

describe('auth-complete events spans', () => {
  it('names the recorded event on its Analytics.track span', async () => {
    trackedEvents.length = 0;

    const response = await beacon(EVENT, ORIGIN);

    expect(response.status).toBe(204);
    expect(trackedEvents).toStrictEqual(['auth_complete_action']);
  });

  it('keeps the span ok for a beacon without a body', async () => {
    spans.length = 0;

    const response = await beaconWithoutBody();

    expect(response.status).toBe(400);
    expect(spans).toStrictEqual([
      { description: 'AuthCompleteEvents.record', status: 'ok' },
    ]);
  });

  it('fails the span for a body stream that fails while it is read', async () => {
    spans.length = 0;

    const response = await beaconWithFailingBody();

    expect(response.status).toBe(400);
    expect(spans).toStrictEqual([
      { description: 'AuthCompleteEvents.record', status: 'internal_error' },
    ]);
  });

  it.each([
    { name: 'a recorded beacon', body: EVENT, origin: ORIGIN, status: 204 },
    {
      name: 'another origin',
      body: EVENT,
      origin: 'https://evil.example',
      status: 403,
    },
    {
      name: 'an oversized body',
      body: 'x'.repeat(257),
      origin: ORIGIN,
      status: 413,
    },
    { name: 'invalid JSON', body: '{', origin: ORIGIN, status: 400 },
  ])('keeps the span ok for $name', async ({ body, origin, status }) => {
    spans.length = 0;

    const response = await beacon(body, origin);

    expect(response.status).toBe(status);
    expect(spans).toStrictEqual([
      { description: 'AuthCompleteEvents.record', status: 'ok' },
    ]);
  });
});
