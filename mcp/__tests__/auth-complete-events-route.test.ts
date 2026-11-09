import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/auth-complete/events/route';
import { track } from '../analytics/analytics';

vi.mock('../analytics/analytics', () => ({
  track: vi.fn(),
  flushAnalytics: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@vercel/functions', () => ({
  waitUntil: vi.fn(),
}));

const ORIGIN = 'http://localhost';
const PAGE_VIEW_ID = '3f6a9a3e-2c1b-4d1e-9f5a-0b8c7d6e5f40';

function beacon(body: string, origin: string | null = ORIGIN): NextRequest {
  return new NextRequest(`${ORIGIN}/api/auth-complete/events`, {
    method: 'POST',
    body,
    headers: {
      'content-type': 'text/plain;charset=UTF-8',
      ...(origin ? { origin } : {}),
    },
  });
}

describe('POST /api/auth-complete/events', () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
  });

  it.each([
    'prompt_copied',
    'prompt_copy_failed',
    'docs_clicked',
    'return_clicked',
  ])('records %s against the page view', async (action) => {
    const response = await POST(
      beacon(JSON.stringify({ pageViewId: PAGE_VIEW_ID, action })),
    );

    expect(response.status).toBe(204);
    expect(track).toHaveBeenCalledWith({
      anonymousId: PAGE_VIEW_ID,
      event: 'auth_complete_action',
      properties: { pageViewId: PAGE_VIEW_ID, action },
    });
  });

  it.each([
    [
      'another origin',
      JSON.stringify({ pageViewId: PAGE_VIEW_ID, action: 'docs_clicked' }),
      'https://evil.example',
      403,
    ],
    [
      'no origin',
      JSON.stringify({ pageViewId: PAGE_VIEW_ID, action: 'docs_clicked' }),
      null,
      403,
    ],
    ['an oversized body', 'x'.repeat(257), ORIGIN, 413],
    ['invalid JSON', '{', ORIGIN, 400],
    ['a non-object body', 'null', ORIGIN, 400],
    [
      'an unknown action',
      JSON.stringify({ pageViewId: PAGE_VIEW_ID, action: 'signed_up' }),
      ORIGIN,
      400,
    ],
    [
      'a page view id that is not a UUID',
      JSON.stringify({ pageViewId: 'user-1', action: 'docs_clicked' }),
      ORIGIN,
      400,
    ],
  ])('rejects %s', async (_label, body, origin, status) => {
    const response = await POST(beacon(body, origin));

    expect(response.status).toBe(status);
    expect(track).not.toHaveBeenCalled();
  });
});
