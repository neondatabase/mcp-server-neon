export const LANDING_PAGE_CSS = `
:root {
  color-scheme: dark;
  --black: #000;
  --well: #0e0f10;
  --raised: #1c1d1f;
  --line: #242628;
  --line-strong: #303236;
  --line-control: #61646b;
  --mark: #94979e;
  --white: #fff;
  --text: #e4e5e7;
  --body: #c9cbcf;
  --muted: #94979e;
  --green: #34d59a;
  --red: #ff3621;
  --margin: 10rem;
  --pad: 2.25rem;
  --header: 3.5rem;
  --sans: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --mono: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
html { scroll-padding-top: var(--header); -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  font: 400 1rem/1.5 var(--sans);
  letter-spacing: -0.02em;
  color: var(--text);
  background: var(--black);
  -webkit-font-smoothing: antialiased;
}
[hidden] { display: none !important; }
h1, h2, p, ul, ol, dl, dd { margin: 0; }
ul, ol { padding: 0; list-style: none; }
a { color: inherit; text-decoration: none; }
button { font: inherit; letter-spacing: inherit; color: inherit; cursor: pointer; }
code, pre { font-family: var(--mono); letter-spacing: 0; }
:is(a, button, summary):focus-visible { outline: 2px solid var(--green); outline-offset: 3px; }
::selection { color: var(--black); background: var(--green); }
.frame { width: 100%; max-width: 62rem; margin: 0 auto; }
.page { border: solid var(--line-strong); border-width: 0 1px 1px; margin-bottom: 3rem; }
.nowrap { white-space: nowrap; }
.label, .field-label, .margin, .num, .count, .product-tag, .tab, .badge { font-family: var(--mono); letter-spacing: 0; }

.btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; height: 2.75rem; padding: 0 1.5rem; border: 1px solid transparent; border-radius: 9999px; font-size: 1rem; line-height: 1; white-space: nowrap; transition: color 0.2s, background-color 0.2s, border-color 0.2s; }
.btn-primary { font-weight: 500; color: var(--black); background: var(--white); }
.btn-primary:hover { background: var(--text); }
.btn-outline { color: var(--white); background: rgba(255, 255, 255, 0.02); border-color: var(--line-control); }
.btn-outline:hover { border-color: var(--text); }
.btn-sm { height: 2.25rem; padding: 0 1rem; font-size: 0.875rem; }

.copy-icon { display: grid; flex: none; width: 1rem; height: 1rem; }
.copy-icon svg { grid-area: 1 / 1; width: 100%; height: 100%; }
.copy-icon svg + svg, .copied .copy-icon svg { opacity: 0; }
.copied .copy-icon svg + svg { opacity: 1; }
.copy-square { position: absolute; top: 0.5rem; right: 0.5rem; display: grid; place-items: center; width: 2.25rem; height: 2.25rem; padding: 0; color: var(--muted); background: var(--raised); border: 1px solid var(--line-strong); transition: color 0.2s, border-color 0.2s; }
.copy-square:hover, .copy-square.copied { color: var(--green); border-color: var(--green); }
.copy-square::after { content: ''; position: absolute; inset: -0.3125rem; }

.site-header { position: sticky; top: 0; z-index: 10; background: var(--black); border: solid var(--line-strong); border-width: 0 1px 1px; }
.header-inner { display: flex; align-items: center; gap: 0.875rem; height: var(--header); padding: 0 var(--pad); }
.logo { display: block; flex: none; }
.logo img { display: block; }
.product-tag { padding-left: 0.875rem; font-size: 0.8125rem; font-weight: 500; line-height: 1.5rem; color: var(--green); border-left: 1px solid var(--line-strong); }
.site-nav { display: flex; margin: 0 auto 0 1.25rem; }
.site-nav a, .header-link { display: flex; align-items: center; height: 2.75rem; padding: 0 0.625rem; font-size: 0.9375rem; color: var(--body); transition: color 0.2s; }
.site-nav a:hover, .header-link:hover { color: var(--white); }

.sheet.hero { border-top: 0; }
.hero-hatch { background: repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0 1px, transparent 1px 8px); }
.hero .sheet-body { padding-top: 2.75rem; padding-bottom: 3rem; }
.label { display: flex; align-items: center; gap: 0.5rem; font-size: 0.75rem; font-weight: 500; line-height: 1; text-transform: uppercase; color: var(--body); }
.label svg { flex: none; color: var(--red); }
.hero h1 { margin-top: 1rem; font-size: clamp(2.25rem, 6vw, 3rem); font-weight: 400; line-height: 1.05; letter-spacing: -0.04em; color: var(--white); }
.hero-description { max-width: 32rem; margin-top: 0.875rem; font-size: 1.125rem; line-height: 1.5; color: var(--body); text-wrap: pretty; }
.field-label { font-size: 0.75rem; font-weight: 500; line-height: 1; text-transform: uppercase; color: var(--muted); }
.hero-connect { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 0.5rem 1rem; max-width: 30rem; margin-top: 1.75rem; }
.url-field { position: relative; grid-column: 1 / -1; display: flex; align-items: center; min-width: 0; min-height: 3.5rem; padding: 0.5rem 4rem 0.5rem 1.125rem; background: var(--well); border: 1px solid var(--line-control); }
.url-field code { flex: 1; min-width: 0; font-size: 1.25rem; line-height: 1.3; color: var(--white); overflow-wrap: anywhere; }
.url-field .copy-square { top: 0.4375rem; right: 0.4375rem; width: 2.5rem; height: 2.5rem; }
.url-field .copy-square:not(:hover, .copied) { color: var(--text); border-color: var(--line-control); }
.url-field .copy-square .copy-icon { width: 1.125rem; height: 1.125rem; }
.docs-link { display: inline-flex; align-items: center; gap: 0.5rem; min-height: 1.5rem; font-size: 0.9375rem; color: var(--text); transition: color 0.2s; }
.docs-link:hover { color: var(--green); }
.docs-link svg { flex: none; }
.version { display: inline-block; margin-left: 0.375rem; padding: 0.25rem 0.4375rem; font: 500 0.8125rem/1 var(--mono); letter-spacing: 0; vertical-align: 0.7em; color: var(--text); background: var(--black); border: 1px solid var(--line-control); }

.sheet { display: grid; grid-template-columns: var(--margin) minmax(0, 1fr); border-top: 1px solid var(--line-strong); }
.margin { display: flex; flex-direction: column; gap: 0.5rem; padding: 2rem 1rem 2rem var(--pad); font-size: 0.8125rem; font-weight: 500; line-height: 1.25; text-transform: uppercase; color: var(--muted); border-right: 1px solid var(--line-strong); }
.margin .num { color: var(--green); }
.margin-label { position: sticky; top: calc(var(--header) + 2rem); display: flex; flex-direction: column; gap: 0.5rem; }
.sheet, .footer { position: relative; }
.sheet::before, .footer::before { content: ''; position: absolute; top: -5px; left: calc(var(--margin) - 5px); z-index: 1; width: 9px; height: 9px; background: linear-gradient(var(--mark), var(--mark)) center / 1px 100% no-repeat, linear-gradient(var(--mark), var(--mark)) center / 100% 1px no-repeat; pointer-events: none; }
.sheet.hero::before { display: none; }
.sheet-body { min-width: 0; padding: 1.75rem var(--pad) 2.5rem 2rem; }
.sheet-body h2 { font-size: 1.5rem; font-weight: 400; line-height: 1.2; letter-spacing: -0.03em; color: var(--white); }
.sheet-desc { margin: 0.375rem 0 1.5rem; font-size: 1.0625rem; color: var(--muted); }

.tabs-row { display: flex; flex-wrap: wrap; padding: 0 0 1px 1px; }
.tab { flex: 1 1 auto; min-height: 2.75rem; margin: 0 0 -1px -1px; padding: 0 1rem; font-size: 0.875rem; font-weight: 500; white-space: nowrap; color: var(--body); background: var(--black); border: 1px solid var(--line-strong); transition: color 0.2s, background-color 0.2s; }
.tab:hover { color: var(--white); background: var(--raised); }
.tab[aria-selected="true"] { position: relative; color: var(--black); background: var(--white); border-color: var(--white); }
.tab:focus-visible { position: relative; z-index: 1; }
.tab-panel { padding: 1.5rem; border: 1px solid var(--line-strong); border-top: 0; }

.prose { font-size: 1.0625rem; line-height: 1.6; color: var(--body); }
.prose > * { margin: 0 0 1rem; }
.prose > :last-child { margin-bottom: 0; }
.prose a:not(.btn) { color: var(--white); text-decoration: underline; text-decoration-color: var(--line-control); text-underline-offset: 0.25em; overflow-wrap: anywhere; transition: text-decoration-color 0.2s; }
.prose a:not(.btn):hover { text-decoration-color: var(--green); }
.prose strong { font-weight: 500; color: var(--white); }
.prose ol { counter-reset: step; }
.prose ol li { position: relative; padding: 0.875rem 0 0.875rem 2.75rem; border-top: 1px solid var(--line); counter-increment: step; }
.prose ol li:last-child { border-bottom: 1px solid var(--line); }
.prose ol li::before { content: '0' counter(step); position: absolute; left: 0; top: 1.0625rem; font: 500 0.8125rem/1.5 var(--mono); letter-spacing: 0; color: var(--green); }
:is(.prose, .param) :not(pre) > code { padding: 0.0625rem 0.3125rem; font-size: 0.875em; color: var(--white); background: var(--raised); overflow-wrap: anywhere; }
.code-block { position: relative; background: var(--well); border: 1px solid var(--line-strong); }
.code-block pre { margin: 0; padding: 0.9375rem 3.5rem 0.9375rem 1.25rem; font-size: 0.9375rem; line-height: 1.6; color: var(--white); white-space: pre-wrap; overflow-wrap: anywhere; }
.code-block[data-lang="bash"] pre { padding-left: 2.75rem; }
.code-block[data-lang="bash"]::before { content: '$'; position: absolute; left: 1.25rem; top: 0.9375rem; font: 0.9375rem/1.6 var(--mono); color: var(--green); }

.params { margin-bottom: 1.5rem; border: 1px solid var(--line-strong); }
.param { display: grid; grid-template-columns: 12.5rem minmax(0, 1fr); border-top: 1px solid var(--line-strong); }
.param:first-child { border-top: 0; }
.param dt { padding: 0.875rem 1.125rem; background: var(--well); border-right: 1px solid var(--line-strong); }
.param dt code { padding: 0; font-size: 0.9375rem; line-height: 1.8; color: var(--green); background: none; }
.param dd { padding: 0.875rem 1.125rem; font-size: 1.0625rem; line-height: 1.7; color: var(--body); }

.tool-groups { border: 1px solid var(--line-strong); }
.tool-group + .tool-group { border-top: 1px solid var(--line-strong); }
.tool-group summary { display: grid; grid-template-columns: minmax(0, 1fr) auto 1rem; align-items: center; gap: 1rem; min-height: 3rem; padding: 0 1.125rem; font-size: 1.0625rem; color: var(--white); cursor: pointer; list-style: none; transition: background-color 0.2s; }
.tool-group summary::-webkit-details-marker { display: none; }
.tool-group summary:hover, .tool-group[open] summary { background: var(--well); }
.tool-group summary::after { content: ''; justify-self: center; width: 0.4375rem; height: 0.4375rem; margin-top: -0.25rem; border: solid var(--muted); border-width: 0 1.5px 1.5px 0; transform: rotate(45deg); transition: transform 0.2s; }
.tool-group[open] summary::after { margin-top: 0.25rem; transform: rotate(-135deg); }
.count { font-size: 0.875rem; font-weight: 500; text-align: right; color: var(--body); }
.tool-list { border-top: 1px solid var(--line-strong); }
.tool { padding: 0.875rem 1.125rem; }
.tool + .tool { border-top: 1px solid var(--line); }
.tool-name { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.625rem; }
.tool-name code { font-size: 0.9375rem; font-weight: 500; color: var(--white); overflow-wrap: anywhere; }
.tool-title { font-size: 0.9375rem; color: var(--muted); }
.badge { order: 3; padding: 0.125rem 0.375rem; font-size: 0.75rem; font-weight: 500; line-height: 1.2; color: var(--green); border: 1px solid rgba(52, 213, 154, 0.4); }
.tool-desc { margin-top: 0.375rem; font-size: 0.9375rem; line-height: 1.6; color: var(--body); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }

.footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem 1.5rem; padding: 1.5rem var(--pad); border-top: 1px solid var(--line-strong); }
.footer-links { display: flex; flex-wrap: wrap; margin-right: -0.625rem; }
.footer-links a { display: flex; align-items: center; min-height: 2.75rem; padding: 0 0.625rem; font-size: 0.9375rem; color: var(--body); transition: color 0.2s; }
.footer-links a:hover { color: var(--white); }

@media (max-width: 60rem) {
  :root { --margin: 7.5rem; --pad: 1.5rem; }
  .sheet-body { padding-left: 1.5rem; }
  .tabs-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 47.9375rem) {
  :root { --pad: 1rem; --header: 6rem; }
  .hero-hatch { height: 0.75rem; padding: 0; border-bottom: 1px solid var(--line-strong); }
  .hero .sheet-body { padding-top: 1.75rem; padding-bottom: 2rem; }
  .hero-description { font-size: 1.0625rem; }
  .hero-connect { max-width: none; margin-top: 1.5rem; }
  .url-field code { font-size: 1.0625rem; }
  .page { margin-bottom: 0; border-width: 0; }
  .site-header { border-width: 0 0 1px; }
  .header-inner { flex-wrap: wrap; gap: 0 0.75rem; height: auto; padding-top: 0.5rem; }
  .product-tag { padding-left: 0.75rem; margin-right: auto; }
  .site-nav { order: 3; flex: 0 0 calc(100% + 2 * var(--pad)); margin: 0.25rem calc(-1 * var(--pad)) 0; padding: 0 0.375rem; border-top: 1px solid var(--line); overflow-x: auto; scrollbar-width: none; }
  .site-nav::-webkit-scrollbar { display: none; }
  .site-nav a { flex: none; white-space: nowrap; }
  .sheet { grid-template-columns: minmax(0, 1fr); }
  .margin { flex-direction: row; padding: 1.5rem var(--pad) 0; border-right: 0; }
  .margin-label { position: static; flex-direction: row; }
  .sheet::before, .footer::before { display: none; }
  .sheet-body { padding: 0.625rem var(--pad) 2rem; }
  .sheet-desc { margin-bottom: 1.25rem; font-size: 1rem; }
  .prose { font-size: 1rem; }
  .tab { min-height: 3rem; padding: 0 0.25rem; font-size: 0.8125rem; line-height: 1.2; white-space: normal; }
  .tab-panel { padding: 1rem; }
  .code-block pre { padding: 0.875rem 3.5rem 0.875rem 1rem; font-size: 0.8125rem; }
  .code-block[data-lang="bash"] pre { padding-left: 2.25rem; }
  .code-block[data-lang="bash"]::before { left: 1rem; top: 0.875rem; font-size: 0.8125rem; }
  .param { grid-template-columns: minmax(0, 1fr); }
  .param dt { padding: 0.625rem 1rem; border-right: 0; border-bottom: 1px solid var(--line); }
  .param dd { padding: 0.75rem 1rem; font-size: 1rem; }
  .tool-group summary { padding: 0 1rem; }
  .tool { padding: 0.875rem 1rem; }
}
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; }
}`;
