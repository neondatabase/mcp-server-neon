import { describe, expect, it } from 'vitest';
import {
  authCompleteContentSecurityPolicy,
  nativeAppRedirect,
  ONBOARD_AGENT_PROMPT,
  renderAuthCompleteHtml,
  renderAuthCompletePage,
  type AuthCompletePageProps,
} from '../oauth/auth-complete-page';

const render = (props: Omit<AuthCompletePageProps, 'nonce'>) =>
  renderAuthCompleteHtml({ ...props, nonce: 'test-nonce' });

describe('nativeAppRedirect', () => {
  it.each([
    ['cursor://anysphere.cursor-mcp/oauth/callback?code=abc', true],
    ['vscode://vscode.github-authentication/did-authenticate', true],
    ['com.example.app:/oauth2redirect', true],
    ['http://127.0.0.1:55667/callback', false],
    ['https://chatgpt.com/connector_platform_oauth_redirect', false],
    ['javascript:alert(1)', false],
    ['JavaScript:alert(1)', false],
    ['data:text/html,<script>alert(1)</script>', false],
    ['vbscript:msgbox(1)', false],
    ['file:///etc/passwd', false],
    ['blob:https://example.com/uuid', false],
    ['about:blank', false],
    ['not a url', false],
  ])('%s -> %s', (location, expected) => {
    expect(Boolean(nativeAppRedirect(location))).toBe(expected);
  });

  it('returns undefined without a location', () => {
    expect(nativeAppRedirect(null)).toBeUndefined();
  });
});

describe('renderAuthCompleteHtml', () => {
  it.each([
    ['success', 'You’ve approved access to Neon', true],
    ['cancelled', 'Connection cancelled', false],
    ['failed', 'Couldn’t connect to Neon', false],
  ] as const)(
    '%s renders its heading and agent tooling only on success',
    (outcome, title, hasOnboard) => {
      const html = render({ outcome });
      expect(html).toContain(`<h1>${title}</h1>`);
      expect(html.includes('Copy prompt')).toBe(hasOnboard);
      expect(html.includes(ONBOARD_AGENT_PROMPT)).toBe(hasOnboard);
    },
  );

  it('links back to the app and launches it when a return URL is given', () => {
    const html = render({
      outcome: 'success',
      returnUrl: 'cursor://cb?code=a&state=b',
    });
    expect(html).toContain(
      'id="return-link" href="cursor://cb?code=a&amp;state=b"',
    );
    expect(html).toContain('window.location.href = returnLink.href');
  });

  it('does not try to launch anything without a return URL', () => {
    const html = render({ outcome: 'failed' });
    expect(html).not.toContain('return-link');
    expect(html).not.toContain('window.location.href');
    expect(html).toContain(
      'This request expired or is no longer valid. Start again from your app.',
    );
  });

  it('escapes the failure message and return URL', () => {
    const html = render({
      outcome: 'failed',
      message: '<img src=x onerror=alert(1)>',
      returnUrl: 'cursor://cb?x="><script>alert(1)</script>',
    });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('"><script>alert(1)');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('tags its only script and style with the nonce', () => {
    const html = render({ outcome: 'success' });
    expect(html.match(/<script\b[^>]*>/g)).toEqual([
      '<script nonce="test-nonce">',
    ]);
    expect(html.match(/<style\b[^>]*>/g)).toEqual([
      '<style nonce="test-nonce">',
    ]);
  });

  it('drops the single-use callback query from the address bar', () => {
    for (const outcome of ['success', 'cancelled', 'failed'] as const) {
      expect(render({ outcome })).toContain(
        "history.replaceState(null, '', location.pathname);",
      );
    }
  });

  it('keeps the callback query when a reload can retry it', () => {
    expect(render({ outcome: 'failed', retryable: true })).not.toContain(
      'history.replaceState',
    );
  });

  it('falls back to manual copy when the clipboard API is missing', () => {
    expect(render({ outcome: 'success' })).toContain(
      'if (!navigator.clipboard) {',
    );
  });
});

describe('authCompleteContentSecurityPolicy', () => {
  it('only allows nonce-tagged inline code and same-origin assets', () => {
    expect(authCompleteContentSecurityPolicy('n0nce')).toBe(
      [
        "default-src 'none'",
        "script-src 'nonce-n0nce'",
        "style-src 'self' 'nonce-n0nce'",
        "img-src 'self'",
        "font-src 'self'",
        "connect-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join('; '),
    );
  });
});

describe('renderAuthCompletePage', () => {
  it('pairs the page with a CSP for a fresh nonce', () => {
    const nonceOf = (csp: string) =>
      /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
    const first = renderAuthCompletePage({ outcome: 'success' });
    const second = renderAuthCompletePage({ outcome: 'success' });

    const nonce = nonceOf(first.headers['Content-Security-Policy']);
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(first.html).toContain(`<script nonce="${nonce}">`);
    expect(nonceOf(second.headers['Content-Security-Policy'])).not.toBe(nonce);
    expect(first.headers['X-Frame-Options']).toBe('DENY');
    expect(first.headers['Cache-Control']).toBe('no-store');
  });
});

describe('action beacons', () => {
  const pageViewId = '3f6a9a3e-2c1b-4d1e-9f5a-0b8c7d6e5f40';

  it('posts the page view id and action when the page has one', () => {
    const html = render({
      outcome: 'success',
      returnUrl: 'cursor://cb',
      pageViewId,
    });
    expect(html).toContain(`<body data-page-view-id="${pageViewId}">`);
    expect(html).toContain(
      'navigator.sendBeacon("/api/auth-complete/events", JSON.stringify({ pageViewId: pageViewId, action: action }))',
    );
    for (const action of [
      'prompt_copied',
      'prompt_copy_failed',
      'docs_clicked',
      'return_clicked',
    ]) {
      expect(html).toContain(`trackAction('${action}')`);
    }
  });

  it('sends nothing without a page view id', () => {
    const html = render({ outcome: 'success' });
    expect(html).toContain('<body>');
    expect(html).toContain('if (!pageViewId || !navigator.sendBeacon) return;');
  });

  it('keeps the page view id out of the script', () => {
    const html = render({
      outcome: 'success',
      pageViewId: '"></body><script>x',
    });
    expect(html).toContain(
      'data-page-view-id="&quot;&gt;&lt;/body&gt;&lt;script&gt;x"',
    );
    expect(html).not.toContain('"></body><script>x');
  });
});
