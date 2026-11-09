import he from 'he';
import { CONSENT_HTML_HEADERS } from './consent-html-headers';
import {
  OAUTH_PAGE_BASE_CSS,
  OAUTH_PAGE_CONNECTION_ICONS,
  OAUTH_PAGE_FONT_LINKS,
} from './page-shell';

export type AuthCompleteOutcome = 'success' | 'cancelled' | 'failed';

export type AuthCompletePageProps = {
  outcome: AuthCompleteOutcome;
  /** Native app redirect (code or error attached) the page hands back to the client. */
  returnUrl?: string;
  /** Shown under the heading when authorization failed. Must not come from the request. */
  message?: string;
  /** Per-response CSP nonce for the inline script and style. */
  nonce: string;
  /** Ties the page's action events to its auth_complete_viewed event. */
  pageViewId?: string;
};

// Served by app/api/auth-complete/events/route.ts.
const AUTH_COMPLETE_EVENTS_PATH = '/api/auth-complete/events';

export const AUTH_COMPLETE_ACTIONS = [
  'prompt_copied',
  'prompt_copy_failed',
  'docs_clicked',
  'return_clicked',
] as const;

export type AuthCompleteAction = (typeof AUTH_COMPLETE_ACTIONS)[number];

/**
 * The page can hold a live authorization code in its return link, so nothing
 * but its own nonce-tagged script runs, and it loads nothing from elsewhere.
 */
export function authCompleteContentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** The page with a fresh nonce, and the headers that must go with it. */
export function renderAuthCompletePage(
  props: Omit<AuthCompletePageProps, 'nonce'>,
): { html: string; headers: Record<string, string> } {
  const nonce = Buffer.from(
    crypto.getRandomValues(new Uint8Array(16)),
  ).toString('base64');
  return {
    html: renderAuthCompleteHtml({ ...props, nonce }),
    headers: {
      ...CONSENT_HTML_HEADERS,
      'Content-Security-Policy': authCompleteContentSecurityPolicy(nonce),
    },
  };
}

export const ONBOARD_AGENT_PROMPT =
  'Set me up for Neon. Fetch https://neon.com/prompts/agent-setup.md and follow it.';

// Web schemes keep the plain redirect: the client serves its own landing page.
// The rest could never be a callback, and /api/register does not reject them,
// so they must never reach an href.
const NON_APP_SCHEMES = new Set([
  'http:',
  'https:',
  'javascript:',
  'data:',
  'vbscript:',
  'file:',
  'blob:',
  'about:',
  'filesystem:',
  'ws:',
  'wss:',
]);

/**
 * Returns the redirect as a URL when it targets a native app (cursor://,
 * claude://, ...). Browsers leave the previous page on screen when a redirect
 * hands off to an app, so these get a completion page instead of a bare
 * redirect.
 */
export function nativeAppRedirect(location: string | null): URL | undefined {
  if (!location) return undefined;
  let url: URL;
  try {
    url = new URL(location);
  } catch {
    return undefined;
  }
  return NON_APP_SCHEMES.has(url.protocol) ? undefined : url;
}

const OUTCOME_TEXT = {
  success: {
    title: 'You’ve approved access to Neon',
    subtitle: 'Head back to your app to keep building.',
  },
  cancelled: {
    title: 'Connection cancelled',
    subtitle: 'No access was granted. Start again from your app any time.',
  },
  failed: {
    title: 'Couldn’t connect to Neon',
    subtitle:
      'This request expired or is no longer valid. Start again from your app.',
  },
} satisfies Record<AuthCompleteOutcome, { title: string; subtitle: string }>;

const AGENT_ICONS = [
  ['claude', 'Claude Code'],
  ['codex', 'Codex'],
  ['cursor', 'Cursor'],
  ['copilot', 'GitHub Copilot'],
] as const;

function renderAgentTooling(): string {
  const icons = AGENT_ICONS.map(
    ([file, name]) =>
      `<img src="/images/auth-complete/${file}.svg" width="24" height="24" alt="${name}">`,
  ).join('\n          ');
  return `<section class="tooling" aria-labelledby="tooling-title">
        <div class="tooling-heading">
          <h2 id="tooling-title">Add Neon agent tooling to your AI agent</h2>
          <div class="agent-icons">
          ${icons}
          </div>
        </div>
        <p class="instructions">Paste the prompt into your coding agent.</p>
        <div class="actions">
          <button type="button" class="button button-primary" id="copy-prompt" hidden>Copy prompt</button>
          <a class="docs-link" id="docs-link" href="https://neon.com/docs/ai/ai-agents-tools" target="_blank" rel="noopener noreferrer"><span>Read the docs</span><span class="sr-only"> (opens in a new tab)</span><span class="arrow" aria-hidden="true"><img src="/images/auth-complete/arrow.svg" alt=""></span></a>
        </div>
        <p id="copy-status" class="copy-status" role="status"></p>
        <div id="manual-copy" class="manual-copy" hidden>
          <label for="prompt">Copy this prompt into your coding agent:</label>
          <textarea id="prompt" readonly>${he.escape(ONBOARD_AGENT_PROMPT)}</textarea>
        </div>
      </section>`;
}

function script(
  hasReturn: boolean,
  hasTooling: boolean,
  pageViewId: string | undefined,
): string {
  // The callback's code and state are single use. Dropping them from the
  // address bar keeps a reload or restored tab from replaying a spent
  // transaction, which would show a failure and count against the auth SLO.
  const parts = [
    `
    history.replaceState(null, '', location.pathname);`,
  ];
  // sendBeacon still delivers when the click leaves the page or opens the app.
  parts.push(
    pageViewId
      ? `
    function trackAction(action) {
      if (!navigator.sendBeacon) return;
      navigator.sendBeacon(${JSON.stringify(AUTH_COMPLETE_EVENTS_PATH)}, JSON.stringify({ pageViewId: ${JSON.stringify(pageViewId)}, action: action }));
    }`
      : `
    function trackAction() {}`,
  );
  if (hasReturn) {
    parts.push(`
    var returnLink = document.getElementById('return-link');
    returnLink.addEventListener('click', function () { trackAction('return_clicked'); });
    window.location.href = returnLink.href;`);
  }
  if (hasTooling) {
    parts.push(`
    var copyButton = document.getElementById('copy-prompt');
    var copyStatus = document.getElementById('copy-status');
    var manualCopy = document.getElementById('manual-copy');
    var prompt = document.getElementById('prompt');
    var resetTimer;
    copyButton.hidden = false;
    document.getElementById('docs-link').addEventListener('click', function () { trackAction('docs_clicked'); });
    function showCopied() {
      trackAction('prompt_copied');
      manualCopy.hidden = true;
      copyButton.textContent = 'Copied!';
      copyStatus.classList.add('sr-only');
      copyStatus.textContent = 'Prompt copied. Paste it into your coding agent.';
      resetTimer = setTimeout(function () {
        copyButton.textContent = 'Copy prompt';
        copyStatus.textContent = '';
      }, 2000);
    }
    function showManualCopy() {
      trackAction('prompt_copy_failed');
      copyButton.textContent = 'Copy prompt';
      copyStatus.classList.remove('sr-only');
      copyStatus.textContent = 'Could not copy automatically. Select and copy the prompt below, or read the docs.';
      manualCopy.hidden = false;
      prompt.focus();
      prompt.select();
    }
    copyButton.addEventListener('click', function () {
      clearTimeout(resetTimer);
      copyStatus.textContent = '';
      // Undefined outside secure contexts and in some embedded browsers.
      if (!navigator.clipboard) {
        showManualCopy();
        return;
      }
      navigator.clipboard.writeText(prompt.value).then(showCopied, showManualCopy);
    });`);
  }
  return parts.join('\n');
}

export function renderAuthCompleteHtml(props: AuthCompletePageProps): string {
  const text = OUTCOME_TEXT[props.outcome];
  const { returnUrl } = props;
  const showTooling = props.outcome === 'success';
  const nonce = he.escape(props.nonce);
  const subtitle =
    props.outcome === 'failed' && props.message ? props.message : text.subtitle;
  const returnHtml = returnUrl
    ? `<p class="return">Didn’t open? <a id="return-link" href="${he.escape(returnUrl)}">Return to your app</a></p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>${he.escape(text.title)}</title>
  ${OAUTH_PAGE_FONT_LINKS}
  <style nonce="${nonce}">${OAUTH_PAGE_BASE_CSS}
    body {
      margin: 0;
      padding: 80px 24px;
      font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 16px;
      line-height: 1.375;
      letter-spacing: -0.02em;
      color: var(--text);
      background: var(--bg);
      -webkit-font-smoothing: antialiased;
    }
    h1, h2, p { margin: 0; }
    h1, h2 { font-weight: 400; }
    img { display: block; flex-shrink: 0; }
    main { max-width: 651px; margin: 0 auto; }
    .complete-header { padding: 32px 28px 28px; }
    .card > .tooling { border-top: 1px solid var(--line); }
    h1 { font-size: 28px; color: #fff; }
    .subtitle { margin-top: 6px; color: var(--muted); font-size: 20px; overflow-wrap: anywhere; }
    .return { margin-top: 16px; color: var(--muted); font-size: 15px; }
    .return a { color: var(--text); text-underline-offset: 3px; }
    .return a:hover { color: #fff; }
    .tooling { padding: 28px; }
    .tooling-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
    h2 { color: var(--text); font-size: 24px; }
    .agent-icons { display: flex; gap: 12px; }
    .instructions { margin-top: 10px; color: var(--muted); font-size: 18px; }
    .actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 16px; margin-top: 24px; }
    .docs-link { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; color: #fff; font-weight: 500; line-height: 1; text-decoration: none; }
    .arrow { display: flex; align-items: center; justify-content: center; width: 16px; height: 12px; transition: transform 200ms ease; }
    .arrow img { transform: rotate(90deg); }
    .docs-link:hover .arrow { transform: translateX(4px); }
    .copy-status:not(:empty) { margin-top: 16px; color: var(--muted); }
    .manual-copy { margin-top: 16px; }
    .manual-copy label { display: block; margin-bottom: 8px; }
    .manual-copy textarea { width: 100%; min-height: 120px; padding: 12px; border: 1px solid var(--line); border-radius: 4px; background: #000; color: var(--text); font: 14px/1.5 ui-monospace, monospace; resize: vertical; }
    .close-hint { margin-top: 20px; color: var(--muted); text-align: center; }
    @media (prefers-reduced-motion: reduce) { .arrow { transition: none; } }
    @media (max-width: 600px) {
      body { padding: 56px 20px; }
      .complete-header, .tooling { padding: 24px; }
      h1 { font-size: 26px; }
      .subtitle { font-size: 18px; }
      h2 { font-size: 22px; }
    }
  </style>
</head>
<body>
  <main>
    <div class="card">
      <header class="complete-header">
        ${OAUTH_PAGE_CONNECTION_ICONS}
        <h1>${he.escape(text.title)}</h1>
        <p class="subtitle">${he.escape(subtitle)}</p>
        ${returnHtml}
      </header>
      ${showTooling ? renderAgentTooling() : ''}
    </div>
    <p class="close-hint">You can close this window.</p>
  </main>
  <script nonce="${nonce}">${script(Boolean(returnUrl), showTooling, props.pageViewId)}
  </script>
</body>
</html>`;
}
