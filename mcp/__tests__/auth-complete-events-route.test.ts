import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { POST } from '../../app/api/auth-complete/events/route';
import { flushAnalytics, track } from '../analytics/analytics';

vi.mock('../analytics/analytics', () => ({
  track: vi.fn(),
  flushAnalytics: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@vercel/functions', () => ({
  waitUntil: vi.fn(),
}));

const ORIGIN = 'http://localhost';
const PAGE_VIEW_ID = '3f6a9a3e-2c1b-4d1e-9f5a-0b8c7d6e5f40';

function event(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    pageViewId: PAGE_VIEW_ID,
    action: 'docs_clicked',
    ...fields,
  });
}

function beacon(
  body: BodyInit,
  origin: string | null = ORIGIN,
  secFetchSite?: string,
): NextRequest {
  return new NextRequest(`${ORIGIN}/api/auth-complete/events`, {
    method: 'POST',
    body,
    headers: {
      'content-type': 'text/plain;charset=UTF-8',
      ...(origin ? { origin } : {}),
      ...(secFetchSite ? { 'sec-fetch-site': secFetchSite } : {}),
    },
    // Required by fetch for a streamed request body.
    ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
  });
}

describe('POST /api/auth-complete/events', () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
    vi.mocked(waitUntil).mockClear();
    vi.mocked(flushAnalytics).mockClear();
  });

  it.each([
    'prompt_copied',
    'prompt_copy_failed',
    'docs_clicked',
    'return_clicked',
  ])('records %s against the page view', async (action) => {
    const response = await POST(beacon(event({ action })));

    expect(response.status).toBe(204);
    expect(track).toHaveBeenCalledWith({
      anonymousId: PAGE_VIEW_ID,
      event: 'auth_complete_action',
      properties: { pageViewId: PAGE_VIEW_ID, action },
    });
    expect(waitUntil).toHaveBeenCalledWith(
      vi.mocked(flushAnalytics).mock.results[0]!.value,
    );
  });

  it('accepts a same-origin beacon that Firefox sent with Origin: null', async () => {
    const response = await POST(beacon(event(), 'null', 'same-origin'));

    expect(response.status).toBe(204);
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('rejects Origin: null from another site', async () => {
    const response = await POST(beacon(event(), 'null', 'cross-site'));

    expect(response.status).toBe(403);
    expect(track).not.toHaveBeenCalled();
  });

  it.each([
    ['another origin', event(), 'https://evil.example', 403],
    ['no origin', event(), null, 403],
    ['an oversized body', 'x'.repeat(257), ORIGIN, 413],
    ['invalid JSON', '{', ORIGIN, 400],
    ['a non-object body', 'null', ORIGIN, 400],
    ['an unknown action', event({ action: 'signed_up' }), ORIGIN, 400],
    [
      'a page view id that is not a UUID',
      event({ pageViewId: 'user-1' }),
      ORIGIN,
      400,
    ],
  ])('rejects %s', async (_label, body, origin, status) => {
    const response = await POST(beacon(body, origin));

    expect(response.status).toBe(status);
    expect(track).not.toHaveBeenCalled();
  });

  it('stops reading a body sent without Content-Length once it is too long', async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(200));
      },
    });

    const response = await POST(beacon(body));

    expect(response.status).toBe(413);
    expect(pulls).toBeLessThan(5);
    expect(track).not.toHaveBeenCalled();
  });
});
