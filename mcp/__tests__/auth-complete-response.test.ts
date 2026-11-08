import he from 'he';
import { describe, expect, it } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { presentToBrowser } from '../oauth/auth-complete-response';

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
          callbackRequest(),
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
        callbackRequest(),
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

      const response = await presentToBrowser(callbackRequest(), original);

      expect(response.headers.getSetCookie()).toEqual(
        original.headers.getSetCookie(),
      );
    });
  });

  it.each([
    'http://127.0.0.1:55667/callback?code=c',
    'https://chatgpt.com/connector_platform_oauth_redirect?code=c',
    'javascript:alert(1)',
  ])('keeps the plain redirect to %s', async (location) => {
    const original = NextResponse.redirect(location);
    const response = await presentToBrowser(callbackRequest(), original);
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
      },
    );

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
