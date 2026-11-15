export const LANDING_PAGE_CSS = `
:root {
  color-scheme: dark;
  --bg: #000;
  --surface: #0c0d0d;
  --panel: #111315;
  --panel-raised: #18191b;
  --line: #242628;
  --line-strong: #303236;
  --text: #e4e5e7;
  --muted: #94979e;
  --heading: #fff;
  --green: #34d59a;
  --highlight-bg: #0d221a;
  --highlight-text: #cddfd7;
  --gutter: clamp(0.75rem, 4vw, 1.5rem);
  --mono: GeistMono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  min-height: 100vh;
  font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 16px;
  line-height: 1.6;
  letter-spacing: -0.02em;
  color: var(--text);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
}
[hidden] { display: none !important; }
a { color: var(--green); text-decoration: none; text-underline-offset: 3px; }
a:hover { text-decoration: underline; }
button { font: inherit; letter-spacing: inherit; cursor: pointer; }
:is(a, button, summary):focus-visible { outline: 2px solid var(--green); outline-offset: 3px; }
code, pre { font-family: var(--mono); letter-spacing: 0; }
h1, h2, h3, p, ol, ul { margin: 0; }

.layout { position: relative; max-width: 52rem; margin: 0 auto; padding: clamp(1.25rem, 5vw, 2.5rem) var(--gutter); }
.rail { position: absolute; background: var(--line); pointer-events: none; }
.rail-left, .rail-right { top: 0; bottom: 0; width: 1px; }
.rail-left { left: var(--gutter); }
.rail-right { right: var(--gutter); }
.rail-top, .rail-bottom { left: var(--gutter); right: var(--gutter); height: 1px; }
.rail-top { top: 0; }
.rail-bottom { bottom: 0; }
.corner { position: absolute; width: 22px; height: 21px; color: var(--line-strong); pointer-events: none; }
.corner-tl { left: var(--gutter); top: 0; transform: translate(-50%, -50%); }
.corner-tr { right: var(--gutter); top: 0; transform: translate(50%, -50%); }
.corner-bl { left: var(--gutter); bottom: 0; transform: translate(-50%, 50%); }
.corner-br { right: var(--gutter); bottom: 0; transform: translate(50%, 50%); }

.card { position: relative; background: var(--surface); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); margin-bottom: 1.5rem; }
.card-header { padding: 1.5rem 1.5rem 0.5rem; }
.card-content { padding: 0 1.5rem 1.5rem; }
.card-title { margin-bottom: 0.25rem; font-size: 1.25rem; font-weight: 500; line-height: 1.3; color: var(--heading); }
.card-desc { font-size: 0.9375rem; color: var(--muted); margin-bottom: 1rem; }

.hero-media { position: relative; padding: clamp(5rem, 14vw, 8rem) clamp(0.75rem, 3vw, 1.5rem) clamp(0.75rem, 3vw, 1.5rem); overflow: hidden; background: var(--bg); }
.hero-video { position: absolute; inset: 0; width: 100%; height: 100%; display: block; object-fit: cover; object-position: center top; opacity: 0; transition: opacity 0.8s ease; pointer-events: none; }
.hero-video.ready { opacity: 1; }
.hero-inner {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: clamp(1.5rem, 5vw, 2.5rem) clamp(1rem, 4vw, 2rem);
  text-align: center;
  background: rgba(0, 0, 0, 0.6);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.hero-logo { display: inline-flex; margin-bottom: 1.25rem; }
.hero-logo img { display: block; height: 28px; width: auto; }
.hero h1 { font-size: clamp(1.75rem, 5vw, 2.25rem); line-height: 1.2; font-weight: 500; letter-spacing: -0.03em; color: var(--heading); }
.hero .version { font-size: 0.9375rem; font-weight: 400; letter-spacing: 0; color: var(--muted); white-space: nowrap; }
.hero-description { max-width: 34rem; margin-top: 0.5rem; color: var(--muted); }

.url-pill { position: relative; display: flex; align-items: center; width: 100%; max-width: 30rem; margin: 1.75rem auto 1rem; }
.url-pill code {
  flex: 1;
  min-width: 0;
  padding: 0.8125rem 3.25rem 0.8125rem 1.25rem;
  font-size: 0.875rem;
  color: var(--text);
  background: var(--panel);
  border: 1px solid var(--line-strong);
  border-radius: 9999px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}
.url-pill .copy-btn { top: 50%; right: 0.375rem; transform: translateY(-50%); border-radius: 9999px; }

.cta-row { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.75rem; }
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 2.75rem;
  padding: 0 1.75rem;
  border-radius: 9999px;
  font-size: 1rem;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  text-decoration: none;
  transition: background 0.15s, border-color 0.15s;
}
.btn:hover { text-decoration: none; }
.btn-primary { color: #1a1a1a; background: #fff; border: 1px solid #fff; }
.btn-primary:hover { background: #dcdde0; border-color: #dcdde0; }
.tabs-row { display: flex; margin-bottom: 1.5rem; border: 1px solid var(--line); overflow-x: auto; scrollbar-width: none; }
.tabs-row::-webkit-scrollbar { display: none; }
.tab {
  flex: 1 0 auto;
  padding: 0.75rem 1rem;
  font-size: 0.8125rem;
  font-weight: 500;
  white-space: nowrap;
  color: var(--muted);
  background: transparent;
  border: none;
  border-right: 1px solid var(--line);
  transition: background 0.15s, color 0.15s;
}
.tab:last-child { border-right: none; }
.tab:hover { color: #fff; }
.tab[aria-selected="true"] { color: #fff; background: var(--panel-raised); box-shadow: inset 0 -1px 0 #fff; }
.tab-panel h3 { font-size: 1.125rem; font-weight: 500; color: var(--heading); margin-bottom: 0.75rem; }
.tab-panel p, .card-content > p { color: var(--muted); margin: 0.75rem 0; }
.tab-panel > :first-child, .card-content > :first-child { margin-top: 0; }
.install-btn { margin: 0.25rem 0 0.75rem; height: 2.25rem; padding: 0 1rem; font-size: 0.875rem; }

.code-block { position: relative; margin: 0.75rem 0 1rem; }
.code-block pre {
  margin: 0;
  padding: 0.875rem 3.25rem 0.875rem 1rem;
  font-size: 0.875rem;
  line-height: 1.6;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--line);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.code-block .copy-btn { top: 0.5rem; right: 0.5rem; }
.nowrap { white-space: nowrap; }
.copy-btn {
  position: absolute;
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  color: var(--muted);
  background: var(--panel-raised);
  border: 1px solid var(--line-strong);
  border-radius: 4px;
  transition: color 0.15s, border-color 0.15s;
}
.copy-btn:hover, .copy-btn.copied { color: var(--green); border-color: var(--green); }
.copy-btn svg { width: 14px; height: 14px; }

ol.steps { padding-left: 1.25rem; }
ol.steps li { margin: 0.5rem 0; color: var(--muted); }
ol.steps strong { color: var(--text); font-weight: 500; }

.params { display: grid; gap: 0.875rem; margin: 0.75rem 0 1.25rem; padding: 0; list-style: none; }
.params li { display: grid; grid-template-columns: minmax(9.5rem, auto) 1fr; gap: 0.375rem 1rem; align-items: baseline; color: var(--muted); }
.params code, .chip { font-size: 0.8125rem; color: var(--text); background: var(--bg); border: 1px solid var(--line); padding: 0.125rem 0.4rem; }
.params code { justify-self: start; }
.chips { display: flex; flex-wrap: wrap; gap: 0.375rem; margin-top: 0.625rem; }

.tool-group { border-top: 1px solid var(--line); }
.tool-group:last-child { border-bottom: 1px solid var(--line); }
.tool-group summary {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.875rem 0;
  font-weight: 500;
  color: var(--heading);
  cursor: pointer;
  list-style: none;
}
.tool-group summary::-webkit-details-marker { display: none; }
.tool-group summary:hover { color: var(--green); }
.tool-group summary::after { content: '+'; margin-left: auto; color: var(--muted); font-size: 1.125rem; line-height: 1; }
.tool-group[open] summary::after { content: '−'; }
.count { font-size: 0.8125rem; font-weight: 400; color: var(--muted); }
.tool-list { display: grid; padding-bottom: 0.5rem; }
.tool { padding: 0.875rem 0; border-top: 1px solid var(--line); }
.tool-name { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.625rem; }
.tool-name code { font-size: 0.875rem; color: var(--heading); overflow-wrap: anywhere; }
.tool-name span { font-size: 0.875rem; color: var(--muted); }
.badge { padding: 0 0.375rem; font-size: 0.6875rem; font-weight: 500; color: var(--highlight-text); background: var(--highlight-bg); }
.tool-desc {
  margin-top: 0.375rem;
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--muted);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.footer { display: flex; flex-direction: column; align-items: center; gap: 1.25rem; padding: 2.5rem 1.5rem; }
.footer-brand { display: inline-flex; }
.footer-brand img { display: block; height: 24px; width: auto; }
.footer-links { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.5rem 1.75rem; font-size: 0.875rem; }
.footer-links a { color: var(--muted); }
.footer-links a:hover { color: #fff; text-decoration: none; }

@media (min-width: 40rem) {
  .tab { flex: 1 1 0; }
}
@media (max-width: 40rem) {
  .tabs-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); overflow: visible; }
  .tab { padding: 0.75rem 0.25rem; white-space: normal; line-height: 1.3; border-bottom: 1px solid var(--line); }
  .tab:nth-child(3n) { border-right: none; }
  .tab:nth-last-child(-n + 3) { border-bottom: none; }
  .card-header { padding: 1.5rem 1.25rem 0.5rem; }
  .card-content { padding: 0 1.25rem 1.25rem; }
  .code-block pre { font-size: 0.8125rem; }
  .params li { grid-template-columns: 1fr; }
}
@media (max-width: 22rem) {
  .tabs-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .tab:nth-child(3n) { border-right: 1px solid var(--line); }
  .tab:nth-child(2n) { border-right: none; }
  .tab:nth-last-child(3) { border-bottom: 1px solid var(--line); }
}
@media (max-width: 30rem) {
  .cta-row .btn { flex: 1 1 100%; }
  .url-pill code { font-size: 0.8125rem; }
  .corner { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; }
}`;
