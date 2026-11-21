import he from 'he';
import { Effect, Option } from 'effect';
import type { Layer } from 'effect';
import { HttpServerResponse } from 'effect/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitUntil } from '@vercel/functions';
import { flushAnalytics, track } from '../analytics/analytics';
import {
  clientNameForPage,
  presentToBrowser,
} from '../oauth/auth-complete-response';
import { FlowAnswer } from '../oauth/flow-answer';
import type { CompletionContext } from '../oauth/flow-answer';
import { OAuthServices } from '../../lib/http/oauth-services';
import { model } from '../oauth/model';

vi.mock('../analytics/analytics', () => ({
  track: vi.fn(),
  flushAnalytics: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@vercel/functions', () => ({
  waitUntil: vi.fn(),
}));

vi.mock('../oauth/model', () => ({
  model: { getClient: vi.fn() },
}));

const APP_CALLBACK = 'cursor://anysphere.cursor-mcp/oauth/callback';
const BROWSER_ACCEPT = 'text/html,application/xhtml+xml';

const run = async <A>(
  effect: Effect.Effect<A, never, Layer.Success<typeof OAuthServices>>,
) => Effect.runPromise(effect.pipe(Effect.provide(OAuthServices)));

const present = async (
  answer: FlowAnswer,
  { query = '', accept }: { query?: string; accept?: string } = {},
) =>
  HttpServerResponse.toWeb(
    await run(
      presentToBrowser({ answer, accept, query: new URLSearchParams(query) }),
    ),
  );

const redirect = (
  location: string,
  context?: CompletionContext,
  clears?: { id: string; secure: boolean },
) =>
  FlowAnswer.Redirect({
    location,
    status: 307,
    clears: Option.fromUndefinedOr(clears),
    context: Option.fromUndefinedOr(context),
  });

/** A native-app redirect, tagged the way /callback tags it. */
const appRedirect = (query: string, relayedError?: string) =>
  redirect(
    `${APP_CALLBACK}${query}`,
    relayedError === undefined ? {} : { relayedError },
  );

const jsonError = (
  body: { error: string; error_description?: string },
  status: number,
  options: {
    headers?: Record<string, string>;
    context?: CompletionContext;
  } = {},
) =>
  FlowAnswer.OAuthError({
    status,
    error: body.error,
    description: body.error_description,
    headers: options.headers ?? {},
    context: Option.fromUndefinedOr(options.context),
  });

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
      ['?code=c&state=s', undefined, 'You’ve approved access to Neon', true],
      [
        '?error=access_denied&state=s',
        'access_denied',
        'Connection cancelled',
        false,
      ],
      [
        '?error=server_error&state=s',
        'server_error',
        'Couldn’t connect to Neon',
        false,
      ],
    ])(
      '%s renders "%s" and hands the redirect back to the app',
      async (query, relayedError, title, hasOnboard) => {
        const location = `${APP_CALLBACK}${query}`;
        const response = await present(appRedirect(query, relayedError), {
          accept: BROWSER_ACCEPT,
        });

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
      const response = await present(
        appRedirect(
          '?error=server_error&error_description=Call%20evil.example',
          'server_error',
        ),
        { accept: BROWSER_ACCEPT },
      );
      const html = await response.text();
      expect(returnLink(html)?.searchParams.get('error_description')).toBe(
        'Call evil.example',
      );
      expect(html.replace(/href="[^"]*"/g, '')).not.toContain('evil.example');
    });

    it('clears the transaction cookies the redirect clears', async () => {
      const answer = redirect(
        `${APP_CALLBACK}?code=c`,
        {},
        { id: 'abc', secure: true },
      );

      const page = await present(answer, { accept: BROWSER_ACCEPT });
      const plain = await present(answer);

      expect(page.headers.getSetCookie()).toStrictEqual(
        plain.headers.getSetCookie(),
      );
      expect(page.headers.getSetCookie().map((c) => c.split('=')[0])).toEqual([
        '__Host-neon_mcp_at_abc',
        'neon_mcp_at_abc',
      ]);
    });

    it.each([
      ['server_error', true],
      ['temporarily_unavailable', true],
      ['invalid_scope', false],
    ])('explains a relayed %s with fixed text', async (error, isTemporary) => {
      const response = await present(
        appRedirect(`?error=${error}&state=s`, error),
        {
          accept: BROWSER_ACCEPT,
        },
      );
      const html = await response.text();
      expect(
        html.includes('Neon could not finish authorization right now.'),
      ).toBe(isTemporary);
      expect(html.includes('This request expired')).toBe(!isTemporary);
    });

    it('keeps the redirect for a non-browser caller', async () => {
      const response = await present(appRedirect('?code=c'));
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(`${APP_CALLBACK}?code=c`);
    });

    it('takes the outcome from /callback, not from the client redirect_uri', async () => {
      // A client can register a redirect_uri that already carries `error`.
      const response = await present(
        appRedirect('?error=access_denied&code=c&state=s'),
        { accept: BROWSER_ACCEPT },
      );
      const html = await response.text();
      expect(html).toContain('<h1>You’ve approved access to Neon</h1>');
      expect(returnLink(html)?.searchParams.get('code')).toBe('c');
    });

    it('keeps a redirect /callback did not tag', async () => {
      const response = await present(redirect(`${APP_CALLBACK}?code=c`), {
        accept: BROWSER_ACCEPT,
      });
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(`${APP_CALLBACK}?code=c`);
    });
  });

  it.each([
    'http://127.0.0.1:55667/callback?code=c',
    'https://chatgpt.com/connector_platform_oauth_redirect?code=c',
    'javascript:alert(1)',
  ])('keeps the plain redirect to %s', async (location) => {
    const response = await present(redirect(location, {}), {
      accept: BROWSER_ACCEPT,
    });
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(location);
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
        '?code=c&state=s',
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
        '?code=c&state=s',
        'Couldn’t connect to Neon',
        'Neon could not finish authorization right now. Start again from your app.',
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
        const response = await present(jsonError(body, status), {
          query,
          accept: BROWSER_ACCEPT,
        });

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
      const response = await present(
        jsonError({ error: 'temporarily_unavailable' }, 503, {
          headers: { 'Retry-After': '30' },
          context: { retryable: true },
        }),
        { query: '?code=c&state=s', accept: BROWSER_ACCEPT },
      );

      expect(response.status).toBe(503);
      expect(response.headers.get('retry-after')).toBe('30');
      const html = await response.text();
      expect(html).toContain('Reload this page in a moment to try again.');
      expect(html).not.toContain('history.replaceState');
    });

    it.each([400, 500])(
      'shows a neutral page and reports nothing for a bare /callback %i',
      async (status) => {
        const response = await present(
          jsonError({ error: 'invalid_request' }, status),
          { accept: BROWSER_ACCEPT },
        );

        expect(response.status).toBe(status);
        const html = await response.text();
        expect(html).toContain('<h1>Nothing to finish here</h1>');
        expect(html).not.toContain('data-page-view-id');
        expect(track).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['a non-browser caller', undefined],
      ['a JSON client', 'application/json'],
    ])('keeps JSON for %s', async (_label, accept) => {
      const response = await present(
        jsonError({ error: 'invalid_request' }, 400),
        { accept },
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toStrictEqual({
        error: 'invalid_request',
      });
    });
  });
});

describe('auth_complete_viewed', () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
    vi.mocked(waitUntil).mockClear();
    vi.mocked(flushAnalytics).mockClear();
  });

  it('reports a success with the user and client the callback knew', async () => {
    const response = await present(
      redirect(`${APP_CALLBACK}?code=c`, {
        userId: 'user-1',
        clientId: 'client-1',
        clientName: 'Cursor',
      }),
      { accept: BROWSER_ACCEPT },
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
        retryable: false,
      },
    });
    expect(waitUntil).toHaveBeenCalledWith(
      vi.mocked(flushAnalytics).mock.results[0]!.value,
    );
    expect(await response.text()).toContain(
      `<body data-page-view-id="${event.anonymousId}">`,
    );
  });

  it('marks a failure a reload can retry, so its repeat views can be told apart', async () => {
    await present(
      jsonError({ error: 'server_error' }, 500, {
        context: { retryable: true },
      }),
      { query: '?code=c&state=s', accept: BROWSER_ACCEPT },
    );

    expect(track).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          outcome: 'failed',
          retryable: true,
        }),
      }),
    );
  });

  it('attributes a client registered as Claude to Claude Desktop', async () => {
    await present(
      redirect(`${APP_CALLBACK}?code=c`, { clientName: 'Claude' }),
      {
        accept: BROWSER_ACCEPT,
      },
    );

    expect(track).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          clientApplication: 'claude-desktop',
        }),
      }),
    );
  });

  it('reports a browser failure anonymously', async () => {
    await present(jsonError({ error: 'invalid_request' }, 400), {
      query: '?code=c&state=s',
      accept: BROWSER_ACCEPT,
    });

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

  it('reports nothing when the answer passes through', async () => {
    await present(redirect('http://127.0.0.1:55667/callback?code=c', {}), {
      accept: BROWSER_ACCEPT,
    });
    expect(track).not.toHaveBeenCalled();
  });
});

describe('clientNameForPage', () => {
  beforeEach(() => {
    vi.mocked(model.getClient).mockReset();
  });

  it('names a registered client whose redirect gets a page', async () => {
    vi.mocked(model.getClient).mockResolvedValue({
      client_name: 'Cursor',
    } as never);

    await expect(
      run(
        clientNameForPage({ clientId: 'client-1', redirectUri: APP_CALLBACK }),
      ),
    ).resolves.toBe('Cursor');
  });

  it.each([
    ['a web redirect', 'client-1', 'https://chatgpt.com/cb'],
    ['a loopback redirect', 'client-1', 'http://127.0.0.1:55667/callback'],
    [
      'a client ID metadata document',
      'https://client.example/metadata.json',
      APP_CALLBACK,
    ],
  ])('skips the lookup for %s', async (_label, clientId, redirectUri) => {
    await expect(
      run(clientNameForPage({ clientId, redirectUri })),
    ).resolves.toBeUndefined();
    expect(model.getClient).not.toHaveBeenCalled();
  });

  it('leaves the name out when the lookup fails', async () => {
    vi.mocked(model.getClient).mockRejectedValue(new Error('db down'));

    await expect(
      run(
        clientNameForPage({ clientId: 'client-1', redirectUri: APP_CALLBACK }),
      ),
    ).resolves.toBeUndefined();
  });
});
