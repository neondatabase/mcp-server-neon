/**
 * Shared look of the OAuth pages the browser sees (consent and completion):
 * fonts, color tokens, base resets, the client-to-Neon header, and buttons.
 * Page-specific layout stays with each page and is placed after this CSS so
 * it can override it.
 */

export const OAUTH_PAGE_FONT_LINKS = `<link rel="preload" href="/fonts/inter/inter-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/fonts/inter/inter.css">`;

export const OAUTH_PAGE_BASE_CSS = `
    :root {
      color-scheme: dark;
      --text: #e4e5e7;
      --muted: #94979e;
      --bg: #000;
      --card: #0c0d0d;
      --line: #303236;
      --green: #34d59a;
      --danger: #ff7d87;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      line-height: 1.375;
      letter-spacing: -0.02em;
      color: var(--text);
      background: var(--bg);
    }
    [hidden] { display: none !important; }
    button, input, textarea { font: inherit; letter-spacing: inherit; }
    button { cursor: pointer; }
    :is(button, input, summary, a, textarea):focus-visible {
      outline: 2px solid var(--green);
      outline-offset: 4px;
    }
    .card { background: var(--card); border: 1px solid var(--line); }
    .connection-icons { display: flex; align-items: center; gap: 2.44px; height: 40px; margin-bottom: 16px; }
    .client-icon { display: grid; place-items: center; width: 40px; height: 40px; border: 1px solid #61646b; border-radius: 50%; }
    .connection-line { display: block; width: 22px; height: 2px; }
    .brand { width: 40px; height: 40px; }
    .button { width: 152px; height: 40px; padding: 0 20px; border-radius: 33px; font-size: 16px; line-height: 1; font-weight: 500; }
    .button-primary { border: 1px solid #fff; background: #fff; color: #000; }
    .button-primary:hover { background: #e4e5e7; border-color: #e4e5e7; }
    .button-secondary { border: 1px solid #61646b; background: rgba(255,255,255,0.02); color: #fff; }
    .button-secondary:hover { border-color: var(--text); }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }`;

export const OAUTH_PAGE_CONNECTION_ICONS = `<div class="connection-icons" aria-hidden="true">
          <span class="client-icon"><img src="/images/consent/key.svg" alt="" width="18" height="18"></span>
          <img class="connection-line" src="/images/consent/dash.svg" alt="" width="22" height="2">
          <img class="brand" src="/images/consent/neon.svg" alt="" width="40" height="40">
        </div>`;
