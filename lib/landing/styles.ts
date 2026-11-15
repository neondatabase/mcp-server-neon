export const LANDING_PAGE_CSS = `
:root {
  color-scheme: dark;
  --surface: #0c0d0d;
  --raised: #18191b;
  --line: #242628;
  --line-strong: #303236;
  --text: #e4e5e7;
  --muted: #94979e;
  --green: #34d59a;
  --gutter: clamp(0.75rem, 4vw, 1.5rem);
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font: 16px/1.6 Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  letter-spacing: -0.01em;
  color: var(--text);
  background: #000;
  -webkit-font-smoothing: antialiased;
  -webkit-text-size-adjust: 100%;
}
[hidden] { display: none !important; }
a { color: var(--green); text-decoration: none; text-underline-offset: 3px; }
a:hover { text-decoration: underline; }
button { font: inherit; cursor: pointer; }
:is(a, button, summary):focus-visible { outline: 2px solid var(--green); outline-offset: 3px; }
code, pre { font-family: var(--mono); letter-spacing: 0; }
h1, h2, p { margin: 0; }

.layout { position: relative; max-width: 52rem; margin: 0 auto; padding: clamp(1.25rem, 5vw, 2.5rem) var(--gutter); }
.rail, .corner { position: absolute; pointer-events: none; }
.rail { background: var(--line); }
.rail-left, .rail-right { top: 0; bottom: 0; width: 1px; }
.rail-top, .rail-bottom { left: var(--gutter); right: var(--gutter); height: 1px; }
.rail-left, .corner-tl, .corner-bl { left: var(--gutter); }
.rail-right, .corner-tr, .corner-br { right: var(--gutter); }
.rail-top, .corner-tl, .corner-tr { top: 0; }
.rail-bottom, .corner-bl, .corner-br { bottom: 0; }
.corner { width: 22px; height: 21px; color: var(--line-strong); }
.corner-tl { transform: translate(-50%, -50%); }
.corner-tr { transform: translate(50%, -50%); }
.corner-bl { transform: translate(-50%, 50%); }
.corner-br { transform: translate(50%, 50%); }

.card { position: relative; background: var(--surface); border-block: 1px solid var(--line); margin-bottom: 1.5rem; }
.card-header { padding: 1.5rem 1.5rem 0; }
.card-content { padding: 1rem 1.5rem 1.5rem; }
.card-title { font-size: 1.25rem; font-weight: 500; color: #fff; }
.card-desc { margin-top: 0.25rem; font-size: 0.9375rem; color: var(--muted); }

.hero-media { position: relative; padding: clamp(5rem, 14vw, 8rem) clamp(0.75rem, 3vw, 1.5rem) clamp(0.75rem, 3vw, 1.5rem); overflow: hidden; }
.hero-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: top; opacity: 0; transition: opacity 0.8s; }
.hero-video.ready { opacity: 1; }
.hero-inner {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: clamp(1.5rem, 5vw, 2.5rem) clamp(1rem, 4vw, 2rem);
  text-align: center;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.hero-logo img { display: block; margin-bottom: 0.75rem; }
.hero-inner h1 { font-size: clamp(1.75rem, 5vw, 2.25rem); font-weight: 500; line-height: 1.2; letter-spacing: -0.03em; color: #fff; }
.version { font-size: 0.9375rem; font-weight: 400; letter-spacing: 0; color: var(--muted); white-space: nowrap; }
.hero-description { max-width: 34rem; color: var(--muted); }

.url-pill { position: relative; width: 100%; max-width: 30rem; margin: 1.25rem 0 0.5rem; }
.url-pill code { display: block; padding: 0.8125rem 3.25rem 0.8125rem 1.25rem; font-size: 0.875rem; text-align: left; background: #111315; border: 1px solid var(--line-strong); border-radius: 9999px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.url-pill .copy-btn { top: 50%; right: 0.375rem; transform: translateY(-50%); border-radius: 9999px; }

.btn { display: inline-flex; align-items: center; height: 2.75rem; padding: 0 1.75rem; border-radius: 9999px; font-weight: 500; color: #1a1a1a; background: #fff; text-decoration: none; }
.btn:hover { background: #dcdde0; text-decoration: none; }
.prose .btn { height: 2.25rem; padding: 0 1rem; font-size: 0.875rem; }

.tabs-row { display: flex; margin-bottom: 1.25rem; border: 1px solid var(--line); overflow-x: auto; scrollbar-width: none; }
.tab { flex: 1 1 0; padding: 0.75rem 1rem; font-size: 0.8125rem; font-weight: 500; white-space: nowrap; color: var(--muted); background: none; border: 0; border-right: 1px solid var(--line); }
.tab:last-child { border-right: 0; }
.tab:hover, .tab[aria-selected="true"] { color: #fff; }
.tab[aria-selected="true"] { background: var(--raised); box-shadow: inset 0 -1px 0 #fff; }

.prose > * { margin: 0 0 1rem; }
.prose > :last-child { margin-bottom: 0; }
.prose p, .prose li { color: var(--muted); }
.prose ul, .prose ol { padding-left: 1.25rem; }
.prose li + li { margin-top: 0.5rem; }
.prose strong { font-weight: 500; color: var(--text); }
.prose :not(pre) > code { font-size: 0.8125rem; color: var(--text); background: #000; border: 1px solid var(--line); padding: 0.0625rem 0.375rem; }
.code-block { position: relative; }
.code-block pre { margin: 0; padding: 0.875rem 3.25rem 0.875rem 1rem; font-size: 0.875rem; background: #000; border: 1px solid var(--line); white-space: pre-wrap; overflow-wrap: anywhere; }
.nowrap { white-space: nowrap; }
.copy-btn { position: absolute; top: 0.5rem; right: 0.5rem; display: grid; place-items: center; width: 2rem; height: 2rem; padding: 0; color: var(--muted); background: var(--raised); border: 1px solid var(--line-strong); border-radius: 4px; }
.copy-btn:hover, .copy-btn.copied { color: var(--green); border-color: var(--green); }
.copy-btn svg { width: 14px; height: 14px; }

.tool-group { border-top: 1px solid var(--line); }
.tool-group:last-child { border-bottom: 1px solid var(--line); }
.tool-group summary { display: flex; align-items: center; gap: 0.75rem; padding: 0.875rem 0; font-weight: 500; color: #fff; cursor: pointer; list-style: none; }
.tool-group summary::-webkit-details-marker { display: none; }
.tool-group summary::after { content: '+'; margin-left: auto; color: var(--muted); }
.tool-group[open] summary::after { content: '−'; }
.count { font-size: 0.8125rem; font-weight: 400; color: var(--muted); }
.tool { padding: 0.875rem 0; border-top: 1px solid var(--line); }
.tool-name { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.625rem; font-size: 0.875rem; color: var(--muted); }
.tool-name code { color: #fff; overflow-wrap: anywhere; }
.badge { padding: 0 0.375rem; font-size: 0.6875rem; font-weight: 500; color: #cddfd7; background: #0d221a; }
.tool-desc { margin-top: 0.375rem; font-size: 0.875rem; line-height: 1.5; color: var(--muted); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }

.footer { display: flex; flex-direction: column; align-items: center; gap: 1.25rem; padding: 2.5rem 1.5rem; }
.footer img { display: block; }
.footer-links { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.5rem 1.75rem; font-size: 0.875rem; }
.footer-links a { color: var(--muted); }
.footer-links a:hover { color: #fff; text-decoration: none; }

@media (max-width: 40rem) {
  .tabs-row { display: grid; grid-template-columns: repeat(3, 1fr); }
  .tab { padding: 0.75rem 0.25rem; white-space: normal; line-height: 1.3; border-bottom: 1px solid var(--line); }
  .tab:nth-child(3n) { border-right: 0; }
  .tab:nth-last-child(-n + 3) { border-bottom: 0; }
  .card-header { padding: 1.25rem 1.25rem 0; }
  .card-content { padding: 1rem 1.25rem 1.25rem; }
  .code-block pre { font-size: 0.8125rem; }
  .corner { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .hero-video { transition: none; }
}`;
