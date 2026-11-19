import { LAYOUT_CSS } from './styles-layout';

/**
 * The landing page as an instruction booklet read by scrolling: the left page (cover) stays put,
 * the right page is one long sheet. Colours, type and rules are the spec-sheet design's own tokens.
 */
const COMPONENTS_CSS = `
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
  --hover: #18191b; /* Neon docs: the copy button under the pointer */
  --pad: 2.25rem;
  --sans: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --mono: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

  /* the book */
  --head: 3.5rem; /* running head = the source's header height */
  --foot: 4rem; /* foot of the left page */
  --bar: 2.75rem; /* single column: the sticky part strip */
  --stick: var(--bar); /* where a sticky row inside a part parks, and where an anchor lands */
}

*, ::before, ::after { box-sizing: border-box; }
html {
  scroll-padding-top: var(--stick);
  -webkit-text-size-adjust: 100%;
  background: var(--black);
}
body {
  margin: 0;
  font: 400 1rem/1.5 var(--sans);
  letter-spacing: -0.02em;
  color: var(--text);
  background: var(--black);
  -webkit-font-smoothing: antialiased;
}
h1, h2, h3, p, ul, ol, dl, dd { margin: 0; }
ul, ol { padding: 0; list-style: none; }
a { color: inherit; text-decoration: none; }
button { font: inherit; letter-spacing: inherit; color: inherit; cursor: pointer; }
code, pre { font-family: var(--mono); letter-spacing: 0; }
:is(a, button, summary, [tabindex]):focus-visible { outline: 2px solid var(--green); outline-offset: 3px; }
::selection { color: var(--black); background: var(--green); }
.nowrap { white-space: nowrap; }
.label, .field-label, .margin-label, .num, .count, .product-tag, .tab, .badge { font-family: var(--mono); letter-spacing: 0; }
.num { color: var(--green); }
.sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* ---------- controls (source) ---------- */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; height: 2.75rem; padding: 0 1.5rem; border: 1px solid transparent; border-radius: 9999px; font-size: 1rem; line-height: 1; white-space: nowrap; transition: color 0.2s, background-color 0.2s, border-color 0.2s; }
.btn-primary { font-weight: 500; color: var(--black); background: var(--white); }
.btn-primary:hover { background: var(--text); }

.copy-icon { display: grid; flex: none; width: 1rem; height: 1rem; }
.copy-icon svg { grid-area: 1 / 1; width: 100%; height: 100%; }
.copy-icon svg + svg, .copied .copy-icon svg { opacity: 0; }
.copied .copy-icon svg + svg { opacity: 1; }
/* copy button as in Neon docs: black, grey frame and icon; under the pointer only the fill changes. Copied = the check icon, same grey */
.copy-square { position: absolute; top: 1rem; right: 1rem; display: grid; place-items: center; width: 1.75rem; height: 1.75rem; padding: 0; color: var(--muted); background: var(--black); border: 1px solid var(--line-strong); transition: background-color 0.2s; }
.copy-square:hover { background: var(--hover); }
.copy-square::after { content: ''; position: absolute; inset: -0.5rem; } /* 44px to press */
html:not(.js) .copy-btn { display: none; } /* copying needs script; without it the text is still selectable */

.logo { display: block; flex: none; }
.logo img { display: block; }
.product-tag { padding-left: 0.875rem; font-size: 0.8125rem; font-weight: 500; line-height: 1.5rem; color: var(--green); border-left: 1px solid var(--line-strong); }

/* ---------- the spread ---------- */
.desk { overflow-x: clip; }
.book { position: relative; display: grid; grid-template-columns: minmax(0, 1fr); }

/* single column: the part strip, sticky under the cover */
.bar { position: sticky; top: 0; z-index: 20; background: var(--black); border-bottom: 1px solid var(--line-strong); }
.bar-nav { display: flex; padding: 0 0.375rem; overflow-x: auto; scrollbar-width: none; }
.bar-nav::-webkit-scrollbar { display: none; }
.bar-nav a { position: relative; display: flex; flex: none; align-items: center; height: calc(2.75rem - 1px); padding: 0 0.625rem; font-size: 0.9375rem; white-space: nowrap; color: var(--body); transition: color 0.2s; }
.bar-nav a:hover { color: var(--white); }
.bar-nav a[aria-current] { color: var(--white); }
.bar-nav a[aria-current]::after { content: ''; position: absolute; left: 0.625rem; right: 0.625rem; bottom: -1px; height: 2px; background: var(--white); }

/* left page: the cover */
.cover { display: flex; flex-direction: column; min-width: 0; background: var(--black); border-bottom: 1px solid var(--line-strong); }
.cover-head { display: flex; flex: none; align-items: center; gap: 0.875rem; height: var(--head); padding: 0 var(--pad); border-bottom: 1px solid var(--line-strong); }
.cover-body { display: grid; flex: 1; min-height: 0; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto 1fr; }
.cover-hatch { height: 0.75rem; background: repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0 1px, transparent 1px 8px); border-bottom: 1px solid var(--line-strong); }
.cover-main { display: flex; flex-direction: column; min-width: 0; padding: 1.75rem var(--pad) 2rem; }
.label { display: flex; align-items: center; gap: 0.5rem; font-size: 0.75rem; font-weight: 500; line-height: 1; text-transform: uppercase; color: var(--body); }
.label svg { flex: none; color: var(--red); }
.cover h1 { margin-top: 1rem; font-size: clamp(2.25rem, 6vw, 3rem); font-weight: 400; line-height: 1.05; letter-spacing: -0.04em; color: var(--white); }
.version { display: inline-block; margin-left: 0.375rem; padding: 0.25rem 0.4375rem; font: 500 0.8125rem/1 var(--mono); letter-spacing: 0; vertical-align: 0.7em; color: var(--text); background: var(--black); border: 1px solid var(--line-control); }
.hero-description { max-width: 32rem; margin-top: 0.875rem; font-size: 1.0625rem; line-height: 1.5; color: var(--body); text-wrap: pretty; }
.field-label { font-size: 0.75rem; font-weight: 500; line-height: 1; text-transform: uppercase; color: var(--muted); }
.hero-connect { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 0.5rem 1rem; margin-top: 1.5rem; }
.url-field { position: relative; grid-column: 1 / -1; display: flex; align-items: center; min-width: 0; min-height: 3.5rem; padding: 0.5rem 4rem 0.5rem 1.125rem; background: var(--well); border: 1px solid var(--line-control); }
.url-field code { flex: 1; min-width: 0; font-size: 1.0625rem; line-height: 1.3; color: var(--white); overflow-wrap: anywhere; }
.url-field .copy-square { top: 0.4375rem; right: 0.4375rem; width: 2.5rem; height: 2.5rem; color: var(--text); background: var(--raised); border-color: var(--line-control); }
.url-field .copy-square:hover { background: var(--line-strong); }
.url-field .copy-square::after { inset: -0.125rem; }
.url-field .copy-square .copy-icon { width: 1.125rem; height: 1.125rem; }
.docs-link { display: inline-flex; align-items: center; gap: 0.5rem; min-height: 1.5rem; font-size: 0.9375rem; color: var(--text); transition: color 0.2s; }
.docs-link:hover { color: var(--green); }
.docs-link svg { flex: none; }

/* contents */
.toc { margin-top: 2.5rem; }
.toc ol { margin-top: 0.75rem; border-top: 1px solid var(--line-strong); }
.toc li { border-bottom: 1px solid var(--line); }
.toc li:last-child { border-bottom-color: var(--line-strong); }
.toc a { display: grid; grid-template-columns: 0.75rem auto minmax(1.5rem, 1fr) auto; align-items: baseline; gap: 0 0.625rem; min-height: 3rem; padding: 0.75rem 0; font-size: 1.0625rem; line-height: 1.5rem; color: var(--body); transition: color 0.2s; }
.toc a:hover { color: var(--white); }
.toc .here { align-self: center; width: 0.4375rem; height: 0.4375rem; background: transparent; }
.toc .leader { align-self: end; height: 0.3125rem; margin-bottom: 0.3125rem; background: radial-gradient(circle, var(--line-control) 0.75px, transparent 1px) left center / 6px 2px repeat-x; }
.toc .num { font-size: 0.8125rem; font-weight: 500; }
.toc a[aria-current] { color: var(--white); }
.toc a[aria-current] .here { background: var(--green); }

.cover-foot { display: flex; flex: none; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0 1.5rem; min-height: var(--foot); padding: 0 var(--pad); border-top: 1px solid var(--line-strong); }
.footer-links { display: flex; flex-wrap: wrap; margin: 0 -0.625rem; }
.footer-links a { display: flex; align-items: center; min-height: 2.75rem; padding: 0 0.625rem; font-size: 0.9375rem; color: var(--body); transition: color 0.2s; }
.footer-links a:hover { color: var(--white); }

/* right page: one long sheet, the parts one after another with a rule between them */
.leaves { position: relative; min-width: 0; }
.sheet { position: relative; display: flex; flex-direction: column; min-width: 0; background: var(--black); border-bottom: 1px solid var(--line-strong); }
/* the last part fills the window, so its anchor can bring it to the top like the others */
.sheet:last-child { min-height: calc(100svh - var(--stick)); border-bottom: 0; }
/* the head row names the part in view; it exists on the spread only (the part strip does this job in the single column) */
.sheet-head { display: none; }
.margin-label { display: grid; font-size: 0.8125rem; font-weight: 500; line-height: 1.25; text-transform: uppercase; color: var(--muted); }
/* the four names share one cell, so the row never changes size; the number changes at once,
   the name is erased and typed by script (interactions.ts, retype) by clipping whole letters.
   The rule that shows the current one is generated from the part ids (page.ts) */
.margin-label > span { grid-area: 1 / 1; display: flex; gap: 0.5rem; visibility: hidden; }
.sheet-body { flex: 1; min-width: 0; padding: 1.75rem var(--pad) 2rem; container-type: inline-size; }
.sheet-body > * { max-width: 46rem; }
.sheet-body h2 { font-size: 1.5rem; font-weight: 400; line-height: 1.2; letter-spacing: -0.03em; color: var(--white); }
.sheet-desc { margin: 0.375rem 0 1.25rem; font-size: 1rem; color: var(--muted); text-wrap: pretty; }

/* ---------- part 01: client selector (source tabs) ---------- */
.tabs-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); padding: 0 0 1px 1px; }
.tab { display: flex; align-items: center; justify-content: center; gap: 0.5rem; min-height: 3rem; margin: 0 0 -1px -1px; padding: 0 0.25rem; font-size: 0.8125rem; font-weight: 500; line-height: 1.2; text-align: center; color: var(--body); background: var(--black); border: 1px solid var(--line-strong); transition: color 0.2s, background-color 0.2s; }
.tab:hover { color: var(--white); background: var(--raised); }
.tab[aria-selected='true'] { position: relative; color: var(--black); background: var(--white); border-color: var(--white); }
.tab:focus-visible { position: relative; z-index: 1; }
.client { padding: 1rem; border: 1px solid var(--line-strong); border-top: 0; }
.client-title { display: flex; align-items: baseline; gap: 0.625rem; margin-bottom: 0.875rem; font-size: 1.0625rem; font-weight: 500; line-height: 1.5; color: var(--white); }
html.js .client-title { display: none; } /* the selected cell of the selector is the title */
html.js .client { scroll-margin-top: 17rem; } /* an address that names a client lands with the part's heading and the selector in view above the panel */
html:not(.js) .tabs-row { margin-bottom: 1.5rem; }
html:not(.js) .client { border-top: 1px solid var(--line-strong); }
html:not(.js) .client + .client { border-top: 0; }

.prose { font-size: 1rem; line-height: 1.6; color: var(--body); }
.prose > * { margin: 0 0 1rem; }
.prose > :last-child { margin-bottom: 0; }
.prose a:not(.btn), .param a { color: var(--white); text-decoration: underline; text-decoration-color: var(--line-control); text-underline-offset: 0.25em; overflow-wrap: anywhere; transition: text-decoration-color 0.2s; }
.prose a:not(.btn):hover, .param a:hover { text-decoration-color: var(--green); }
.prose strong { font-weight: 500; color: var(--white); }
.prose ol { counter-reset: step; }
.prose ol li { position: relative; padding: 0.875rem 0 0.875rem 2.75rem; border-top: 1px solid var(--line); counter-increment: step; }
.prose ol li:last-child { border-bottom: 1px solid var(--line); }
.client .prose > ol:first-child > li:first-child { padding-top: 0; border-top: 0; }
.client .prose > ol:first-child > li:first-child::before { top: 0.1875rem; }
.client .prose > ol:last-child > li:last-child { padding-bottom: 0; border-bottom: 0; }
.prose ol li::before { content: '0' counter(step); position: absolute; left: 0; top: 1.0625rem; font: 500 0.8125rem/1.5 var(--mono); letter-spacing: 0; color: var(--green); }
.prose ol li > * + * { margin-top: 0.75rem; }
:is(.prose, .param) :not(pre) > code { padding: 0.0625rem 0.3125rem; font-size: 0.875em; color: var(--white); background: var(--raised); overflow-wrap: anywhere; }
/* code block as in Neon docs: black, 1px frame, square, no prompt sign */
.code-block { position: relative; background: var(--black); border: 1px solid var(--line-strong); }
.code-block pre { margin: 0; padding: 1.25rem 3.5rem 1.25rem 1rem; font-size: 0.875rem; line-height: 1.5; color: var(--white); white-space: pre-wrap; overflow-wrap: anywhere; }

/* ---------- part 03: parameters ---------- */
.params { margin-bottom: 1.5rem; border: 1px solid var(--line-strong); }
.param { display: grid; grid-template-columns: minmax(0, 1fr); border-top: 1px solid var(--line-strong); }
.param:first-child { border-top: 0; }
.param dt { padding: 0.625rem 1rem; background: var(--well); border-bottom: 1px solid var(--line); }
.param dt code { padding: 0; font-size: 0.9375rem; line-height: 1.8; color: var(--green); background: none; }
.param dd { padding: 0.75rem 1rem; font-size: 1rem; line-height: 1.7; color: var(--body); }
.param a { text-decoration-thickness: 1px; }

/* ---------- part 04: parts list ---------- */
.tool-groups { border: 1px solid var(--line-strong); }
.tool-group + .tool-group { border-top: 1px solid var(--line-strong); }
.tool-group summary { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto 1rem; align-items: center; gap: 0 0.75rem; min-height: 3rem; padding: 0.5rem 1rem; font-size: 1.0625rem; line-height: 1.3; color: var(--white); background: var(--black); cursor: pointer; list-style: none; transition: background-color 0.2s; }
.tool-group summary::-webkit-details-marker { display: none; }
.tool-group summary:hover, .tool-group[open] summary { background: var(--well); }
.tool-group[open] summary { position: sticky; top: var(--stick); z-index: 1; box-shadow: 0 1px 0 var(--line-strong), 0 -1px 0 var(--line-strong); }
.tool-group summary:focus-visible { z-index: 2; outline-offset: -2px; }
.tool-group summary::after { content: ''; justify-self: center; width: 0.4375rem; height: 0.4375rem; margin-top: -0.25rem; border: solid var(--muted); border-width: 0 1.5px 1.5px 0; transform: rotate(45deg); transition: transform 0.2s; }
.tool-group[open] summary::after { margin-top: 0.25rem; transform: rotate(-135deg); }
.count { min-width: 2.5rem; font-size: 0.875rem; font-weight: 500; text-align: right; color: var(--body); }
.tool { padding: 0.875rem 1rem; }
.tool + .tool { border-top: 1px solid var(--line); }
.tool-name { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.625rem; }
.tool-name code { font-size: 0.9375rem; font-weight: 500; color: var(--white); overflow-wrap: anywhere; }
.tool-title { font-size: 0.9375rem; color: var(--muted); }
.badge { order: 3; padding: 0.125rem 0.375rem; font-size: 0.75rem; font-weight: 500; line-height: 1.2; color: var(--green); border: 1px solid rgba(52, 213, 154, 0.4); }
.tool-desc { margin-top: 0.375rem; font-size: 0.9375rem; line-height: 1.6; color: var(--body); text-wrap: pretty; }`;

export const LANDING_PAGE_CSS = `${COMPONENTS_CSS}
${LAYOUT_CSS}`;
