import he from 'he';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { track } from '../analytics/analytics';
import {
  presentToBrowser,
  withCompletionContext,
} from '../oauth/auth-complete-response';

vi.mock('../analytics/analytics', () => ({
  track: vi.fn(),
  flushAnalytics: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@vercel/functions', () => ({
  waitUntil: vi.fn(),
}));

const APP_CALLBACK = 'cursor://anysphere.cursor-mcp/oauth/callback';
const BROWSER_ACCEPT = 'text/html,application/xhtml+xml';

function callbackRequest(query = '', accept?: string): NextRequest {
  return new NextRequest(`http://localhost/callback${query}`, {
    headers: accept ? { accept } : {},
  });
}

function returnLink(html: string): URL | undefined {
  const href = /id="return-link" href="([^"]+)"/.exec(html)?.[1];
  return href ? new URL(he.decode(href)) : undefined;
}

describe('presentToBrowser', () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
  });

  describe('native app redirects', () => {
    it.each([
      ['?code=c&state=s', 'You’ve approved access to Neon', true],
      ['?error=access_denied&state=s', 'Connection cancelled', false],
      ['?error=server_error&state=s', 'Couldn’t connect to Neon', false],
    ])(
      '%s renders "%s" and hands the redirect back to the app',
      async (query, title, hasOnboard) => {
        const location = `${APP_CALLBACK}${query}`;
        const response = await presentToBrowser(
          callbackRequest('', BROWSER_ACCEPT),
          NextResponse.redirect(location),
        );

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/html');
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('location')).toBeNull();
        const html = await response.text();
        expect(html).toContain(`<h1>${title}</h1>`);
        expect(html.includes('Copy prompt')).toBe(hasOnboard);
        expect(returnLink(html)?.href).toBe(new URL(location).href);
      },
    );

    it('relays the error_description to the app without showing it', async () => {
      const response = await presentToBrowser(
        callbackRequest('', BROWSER_ACCEPT),
        NextResponse.redirect(
          `${APP_CALLBACK}?error=server_error&error_description=Call%20evil.example`,
        ),
      );
      const html = await response.text();
      expect(returnLink(html)?.searchParams.get('error_description')).toBe(
        'Call evil.example',
      );
      expect(html.replace(/href="[^"]*"/g, '')).not.toContain('evil.example');
    });

    it('keeps the cookies the callback set', async () => {
      const original = NextResponse.redirect(`${APP_CALLBACK}?code=c`);
      original.cookies.set('mcp-consent-abc', '', { maxAge: 0 });

      const response = await presentToBrowser(
        callbackRequest('', BROWSER_ACCEPT),
        original,
      );

      expect(response.headers.getSetCookie()).toEqual(
        original.headers.getSetCookie(),
      );
    });

    it.each([
      ['server_error', true],
      ['temporarily_unavailable', true],
      ['invalid_scope', false],
    ])('explains a relayed %s with fixed text', async (error, isTemporary) => {
      const response = await presentToBrowser(
        callbackRequest('', BROWSER_ACCEPT),
        NextResponse.redirect(`${APP_CALLBACK}?error=${error}&state=s`),
      );
      const html = await response.text();
      expect(
        html.includes('Neon could not finish authorization right now.'),
      ).toBe(isTemporary);
      expect(html.includes('This request expired')).toBe(!isTemporary);
    });

    it('keeps the redirect for a non-browser caller', async () => {
      const original = NextResponse.redirect(`${APP_CALLBACK}?code=c`);
      const response = await presentToBrowser(callbackRequest(), original);
      expect(response).toBe(original);
    });
  });

  it.each([
    'http://127.0.0.1:55667/callback?code=c',
    'https://chatgpt.com/connector_platform_oauth_redirect?code=c',
    'javascript:alert(1)',
  ])('keeps the plain redirect to %s', async (location) => {
    const original = NextResponse.redirect(location);
    const response = await presentToBrowser(
      callbackRequest('', BROWSER_ACCEPT),
      original,
    );
    expect(response).toBe(original);
  });

  describe('JSON failures', () => {
    it.each([
      [
        'a server-written description',
        {
          error: 'invalid_request',
          error_description: 'Missing code or state',
        },
        400,
        '',
        'Couldn’t connect to Neon',
        'This request expired or is no longer valid. Start again from your app.',
      ],
      [
        'a description reflected from the query string',
        { error: 'server_error', error_description: 'Call evil.example' },
        400,
        '?error=server_error&error_description=Call%20evil.example',
        'Couldn’t connect to Neon',
        'This request expired or is no longer valid. Start again from your app.',
      ],
      [
        'an upstream outage',
        {
          error: 'upstream_error',
          error_description: 'Upstream returned a non-conforming response',
        },
        502,
        '',
        'Couldn’t connect to Neon',
        'Neon could not finish authorization right now.',
      ],
      [
        'a cancel without a usable session',
        { error: 'access_denied', error_description: 'denied' },
        400,
        '?error=access_denied&error_description=denied',
        'Connection cancelled',
        'No access was granted.',
      ],
    ])(
      'renders %s for a browser with fixed text',
      async (_label, body, status, query, title, text) => {
        const response = await presentToBrowser(
          callbackRequest(query, BROWSER_ACCEPT),
          NextResponse.json(body, { status }),
        );

        expect(response.status).toBe(status);
        expect(response.headers.get('content-type')).toContain('text/html');
        const html = await response.text();
        expect(html).toContain(`<h1>${title}</h1>`);
        expect(html).toContain(text);
        expect(html).not.toContain(body.error_description);
        expect(html).not.toContain('return-link');
        expect(html).toContain('history.replaceState');
      },
    );

    it('keeps the query and Retry-After when a reload can retry', async () => {
      const response = await presentToBrowser(
        callbackRequest('?code=c&state=s', BROWSER_ACCEPT),
        NextResponse.json(
          { error: 'temporarily_unavailable' },
          { status: 503, headers: { 'Retry-After': '30' } },
        ),
      );

      expect(response.status).toBe(503);
      expect(response.headers.get('retry-after')).toBe('30');
      const html = await response.text();
      expect(html).toContain('Neon could not finish authorization right now.');
      expect(html).not.toContain('history.replaceState');
    });

    it.each([
      ['a non-browser caller', undefined, 400],
      ['a JSON client', 'application/json', 400],
    ])('keeps JSON for %s', async (_label, accept, status) => {
      const original = NextResponse.json(
        { error: 'invalid_request' },
        { status },
      );
      const response = await presentToBrowser(
        callbackRequest('', accept),
        original,
      );
      expect(response).toBe(original);
    });
  });
});

describe('auth_complete_viewed', () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
  });

  it('reports a success with the user and client the callback knew', async () => {
    const response = await presentToBrowser(
      callbackRequest('', BROWSER_ACCEPT),
      withCompletionContext(NextResponse.redirect(`${APP_CALLBACK}?code=c`), {
        userId: 'user-1',
        clientId: 'client-1',
        clientName: 'Cursor',
      }),
    );

    expect(track).toHaveBeenCalledTimes(1);
    const event = vi.mocked(track).mock.calls[0]![0];
    expect(event).toEqual({
      userId: 'user-1',
      anonymousId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      event: 'auth_complete_viewed',
      properties: {
        pageViewId: event.anonymousId,
        outcome: 'success',
        opensApp: true,
        clientId: 'client-1',
        clientName: 'Cursor',
        clientApplication: 'cursor',
      },
    });
    expect(await response.text()).toContain(
      `<body data-page-view-id="${event.anonymousId}">`,
    );
  });

  it('reports a browser failure anonymously', async () => {
    await presentToBrowser(
      callbackRequest('', BROWSER_ACCEPT),
      NextResponse.json({ error: 'invalid_request' }, { status: 400 }),
    );

    expect(track).toHaveBeenCalledWith({
      anonymousId: expect.any(String),
      event: 'auth_complete_viewed',
      properties: expect.objectContaining({
        outcome: 'failed',
        opensApp: false,
        clientApplication: 'unknown',
      }),
    });
    expect(vi.mocked(track).mock.calls[0]![0]).not.toHaveProperty('userId');
  });

  it('reports nothing when the original response passes through', async () => {
    await presentToBrowser(
      callbackRequest('', BROWSER_ACCEPT),
      NextResponse.redirect('http://127.0.0.1:55667/callback?code=c'),
    );
    expect(track).not.toHaveBeenCalled();
  });
});
