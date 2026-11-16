import { describe, expect, it } from 'vitest';

import {
  isLandingPageRequest,
  landingPageFormat,
} from '../../lib/landing/request';

const BROWSER_ACCEPT =
  'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

const request = (method: string, headers: Record<string, string> = {}) =>
  new Request('https://mcp.neon.tech/mcp', { method, headers });

describe('isLandingPageRequest', () => {
  it('accepts a browser navigation', () => {
    expect(
      isLandingPageRequest(request('GET', { Accept: BROWSER_ACCEPT })),
    ).toBe(true);
    expect(isLandingPageRequest(request('GET', { Accept: 'Text/HTML' }))).toBe(
      true,
    );
    expect(
      isLandingPageRequest(request('HEAD', { Accept: BROWSER_ACCEPT })),
    ).toBe(true);
  });

  it('leaves wildcard, JSON, and missing Accept headers to the transport', () => {
    expect(isLandingPageRequest(request('GET'))).toBe(false);
    expect(isLandingPageRequest(request('GET', { Accept: '*/*' }))).toBe(false);
    expect(
      isLandingPageRequest(request('GET', { Accept: 'application/json' })),
    ).toBe(false);
  });

  it('does not treat text/html with q=0 as a navigation', () => {
    expect(
      isLandingPageRequest(request('GET', { Accept: 'text/html;q=0, */*' })),
    ).toBe(false);
    expect(
      isLandingPageRequest(request('GET', { Accept: 'text/html; q=0.5' })),
    ).toBe(true);
  });

  it('leaves an SSE GET to the transport', () => {
    expect(
      isLandingPageRequest(
        request('GET', { Accept: 'text/html, text/event-stream' }),
      ),
    ).toBe(false);
  });

  it('leaves a request with credentials to authentication', () => {
    expect(
      isLandingPageRequest(
        request('GET', {
          Accept: BROWSER_ACCEPT,
          Authorization: 'Bearer expired',
        }),
      ),
    ).toBe(false);
  });

  it('leaves POST and DELETE to the transport', () => {
    for (const method of ['POST', 'DELETE']) {
      expect(
        isLandingPageRequest(request(method, { Accept: BROWSER_ACCEPT })),
      ).toBe(false);
    }
  });
});

describe('landingPageFormat', () => {
  const format = (accept: string) =>
    landingPageFormat(request('GET', { Accept: accept }));

  it('serves HTML to a browser', () => {
    expect(format(BROWSER_ACCEPT)).toBe('html');
  });

  it('serves Markdown when Markdown is asked for', () => {
    expect(format('text/markdown')).toBe('markdown');
    expect(format('Text/Markdown; charset=utf-8')).toBe('markdown');
    expect(format('text/markdown, */*;q=0.1')).toBe('markdown');
  });

  it('serves Markdown on a tie and HTML when HTML has the higher quality', () => {
    expect(format('text/markdown, text/html')).toBe('markdown');
    expect(format('text/html, text/markdown;q=0.5')).toBe('html');
    expect(format('text/markdown;q=0.9, text/html;q=0.8')).toBe('markdown');
  });

  it('does not serve Markdown with q=0', () => {
    expect(format('text/markdown;q=0')).toBeUndefined();
    expect(format('text/markdown;q=0, text/html')).toBe('html');
  });

  it('leaves Markdown requests with credentials or SSE to the transport', () => {
    expect(
      landingPageFormat(
        request('GET', {
          Accept: 'text/markdown',
          Authorization: 'Bearer token',
        }),
      ),
    ).toBeUndefined();
    expect(format('text/markdown, text/event-stream')).toBeUndefined();
  });
});
