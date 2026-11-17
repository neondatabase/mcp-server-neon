/**
 * The spans a `GET /api/list-tools` leaves in Sentry. A request the caller got
 * wrong is answered, not failed, so none of its spans is an error.
 */
import { getClient, init, spanToJSON } from '@sentry/node';
import { describe, expect, it } from 'vitest';

init({ dsn: 'http://public@127.0.0.1:1/1', tracesSampleRate: 1 });

const spans: { description: string | undefined; status: string | undefined }[] =
  [];

getClient()?.on('spanEnd', (span) => {
  const { description, status } = spanToJSON(span);

  if (description?.startsWith('ListTools.') === true) {
    spans.push({ description, status });
  }
});

const { GET } = await import('../../app/api/list-tools/route');

describe('list-tools spans', () => {
  it('keeps every span ok for a malformed roleName', async () => {
    spans.length = 0;

    const response = await GET(
      new Request('http://localhost/api/list-tools?roleName=a-b'),
    );

    expect(response.status).toBe(400);
    expect(spans).toStrictEqual([
      { description: 'ListTools.body', status: 'ok' },
      { description: 'ListTools.get', status: 'ok' },
    ]);
  });

  it('keeps every span ok for a valid request', async () => {
    spans.length = 0;

    const response = await GET(new Request('http://localhost/api/list-tools'));

    expect(response.status).toBe(200);
    expect(spans).toStrictEqual([
      { description: 'ListTools.body', status: 'ok' },
      { description: 'ListTools.get', status: 'ok' },
    ]);
  });
});
