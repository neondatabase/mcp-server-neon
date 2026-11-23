import { LAYOUT_CSS } from './styles-layout';

/**
 * The landing page as an instruction booklet read by scrolling: the left page (cover) stays put,
 * the right page is one long sheet. Colours, type and rules are the spec-sheet design's own tokens.
 */
const COMPONENTS_CSS = `
:root {
  color-scheme: dark;
  /* surfaces */
  --black: #000;
  --fill-hover: #18191b; /* a control under the pointer */
  --fill-strip: #131415; /* the tab strip */
  --fill-code: #0c0d0d; /* inline code */
  /* lines */
  --line: #242628; /* between items inside a group */
  --line-strong: #303236; /* frames and the rules between parts, rows and groups */
  --line-soft: #494b50; /* inside content: the line joining steps, the frame of inline code */
  --line-control: #61646b;
  /* text */
  --white: #fff;
  --text: #e4e5e7;
  --cell: #d7d8db; /* table cells */
  --body: #c9cbcf;
  --muted: #94979e;
  --code: #f9fafa; /* code blocks */
  /* accents */
  --green: #34d59a;
  --badge: #00e599; /* the read-only badge, a brighter green, on a tint of itself */
  --red: #ff3621;
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
.label, .margin-label, .count { font-family: var(--mono); letter-spacing: 0; }
.sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* ---------- controls (source) ---------- */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; height: 2.5rem; padding: 0 1.25rem; border: 1px solid transparent; border-radius: 9999px; font-size: 0.9375rem; line-height: 1; white-space: nowrap; transition: color 0.2s, background-color 0.2s, border-color 0.2s; }
.btn-primary { font-weight: 500; color: var(--black); background: var(--white); }
.btn-primary:hover { background: var(--text); }

.copy-icon { display: grid; flex: none; width: 1rem; height: 1rem; }
.copy-icon svg { grid-area: 1 / 1; width: 100%; height: 100%; }
.copy-icon svg + svg, .copied .copy-icon svg { opacity: 0; }
.copied .copy-icon svg + svg { opacity: 1; }
/* copy button as in Neon docs: black, grey frame and icon; under the pointer only the fill changes. Copied = the check icon, same grey */
.copy-square { position: absolute; top: 1rem; right: 1rem; display: grid; place-items: center; width: 1.75rem; height: 1.75rem; padding: 0; color: var(--muted); background: var(--black); border: 1px solid var(--line-strong); transition: background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
.copy-square:hover { background: var(--fill-hover); }
.copy-square::after { content: ''; position: absolute; inset: -0.5rem; } /* 44px to press */
html:not(.js) .copy-btn { display: none; } /* copying needs script; without it the text is still selectable */

.logo { display: block; flex: none; }
.logo img { display: block; }

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
.cover-head { display: flex; flex: none; align-items: center; gap: 0.875rem; height: var(--head); padding: 0 var(--pad); }
.cover-body { display: grid; flex: 1; min-height: 0; grid-template-columns: minmax(0, 1fr); grid-template-rows: 1fr; }
.cover-main { display: flex; flex-direction: column; min-width: 0; padding: 1.75rem var(--pad) 2rem; }
.label { display: flex; align-items: center; gap: 0.5rem; font-size: 0.75rem; font-weight: 500; line-height: 1; text-transform: uppercase; color: var(--body); }
.label svg { flex: none; color: var(--red); }
.cover h1 { margin-top: 1rem; font-size: clamp(2.25rem, 6vw, 3rem); font-weight: 400; line-height: 1.05; letter-spacing: -0.04em; color: var(--white); }
/* the tag's bottom edge sits on the title's baseline: an inline-block that clips has its baseline at its bottom edge */
.version { display: inline-block; overflow: hidden; margin-left: 0.375rem; padding: 0.25rem 0.4375rem; font: 500 0.8125rem/1 var(--mono); letter-spacing: 0; vertical-align: baseline; color: var(--text); background: var(--black); border: 1px solid var(--line-control); }
.hero-description { max-width: 32rem; margin-top: 0.875rem; font-size: 1.125rem; line-height: 1.5; color: var(--body); text-wrap: pretty; }
.hero-connect { margin-top: 1.5rem; } /* the URL is the same code block as the ones on the right page */

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
/* set like the label of a Neon docs admonition (Security): 13px mono caps, a mark and the name in one colour */
.margin-label { display: grid; font-size: 0.8125rem; font-weight: 500; line-height: 1.25; letter-spacing: 0.01em; text-transform: uppercase; color: var(--green); }
/* the four names share one cell, so the row never changes size and the mark stays put.
   The rule that shows the current one is generated from the part ids (page.ts) */
.margin-label > span { grid-area: 1 / 1; display: flex; align-items: baseline; gap: 0.375rem; visibility: hidden; }
/* centred on the capitals, not on the line box (which leaves room below for descenders) */
.head-mark { position: relative; bottom: calc((1cap - 0.4375rem) / 2); flex: none; width: 0.4375rem; height: 0.4375rem; background: currentColor; }
.sheet-body { flex: 1; min-width: 0; padding: 1.75rem var(--pad) 2rem; container-type: inline-size; }
.sheet-body > * { max-width: 46rem; }
.sheet-body h2 { font-size: 1.5rem; font-weight: 400; line-height: 1.2; letter-spacing: -0.03em; color: var(--white); }
.sheet-desc { margin: 0.375rem 0 1.25rem; font-size: 1rem; color: var(--body); text-wrap: pretty; } /* the colour of the text in the panels below */

/* ---------- part 01: client selector (tabs as in Neon docs: an underlined strip on a frame) ---------- */
/* the strip scrolls sideways when the labels do not fit; its rule is an inset shadow, so it stays
   put while the labels scroll and the selected label's underline paints over it */
.tabs-row { position: relative; display: flex; flex-wrap: nowrap; gap: 0.25rem; min-height: 2.75rem; padding: 0 0.75rem; overflow-x: auto; scrollbar-width: none; background: var(--fill-strip); border: 1px solid var(--line-strong); border-bottom: 0; box-shadow: inset 0 -1px 0 var(--line-strong); }
.tabs-row::-webkit-scrollbar { display: none; }
/* the label has 0.5rem of air each side (the focus ring has room inside the strip); the underline spans the text only */
.tab { position: relative; display: flex; flex: none; align-items: center; padding: 0 0.5rem; font-size: 0.875rem; font-weight: 500; line-height: 1; letter-spacing: -0.02em; white-space: nowrap; color: var(--muted); transition: color 0.2s; }
.tab::after { content: ''; position: absolute; left: 0.5rem; right: 0.5rem; bottom: 0; height: 1px; background: transparent; transition: background-color 0.2s; }
.tab:hover, .tab[aria-selected='true'] { color: var(--white); }
.tab[aria-selected='true']::after { background: var(--white); }
.tab:focus-visible { outline-offset: -2px; }
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
/* links as in Neon docs: white, a 1px dashed underline at 40% that firms to 70% under the pointer */
.prose a:not(.btn), .params a { color: var(--white); text-decoration: underline 1px dashed rgba(255, 255, 255, 0.4); text-underline-offset: 4px; overflow-wrap: anywhere; transition: text-decoration-color 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
.prose a:not(.btn):hover, .params a:hover { text-decoration-color: rgba(255, 255, 255, 0.7); }
:is(.prose, .params) a:has(> code) { text-underline-offset: 2px; }
.prose strong { font-weight: 500; color: var(--white); }
.client ol { counter-reset: step; }
/* numbered steps as in Neon docs: the number in a light circle centred on the first line, a line
   down to the next circle with 0.25rem of air at each end (none under the last one). Steps are a
   client panel's numbered list, so the first line is 16px × 1.6 = 1.6rem tall and the 1.5rem
   circle sits half the difference below its top */
.client ol li { position: relative; padding: 0 0 1.5rem 2.5rem; counter-increment: step; }
.client ol li:last-child { padding-bottom: 0; }
.client ol li::before { content: counter(step); position: absolute; left: 0; top: 0.05rem; display: grid; place-items: center; width: 1.5rem; height: 1.5rem; font: 500 0.8125rem/1 var(--mono); letter-spacing: 0; color: var(--black); background: var(--text); border-radius: 50%; }
.client ol li::after { content: ''; position: absolute; left: calc(0.75rem - 0.5px); top: 1.8rem; bottom: 0.2rem; width: 1px; background: var(--line-soft); }
.client ol li:last-child::after { display: none; } /* the last step leads nowhere */
.client ol li > * + * { margin-top: 0.75rem; }
/* inline code as in Neon docs: 14px, a thin frame with 4px corners */
:is(.prose, .params) :not(pre) > code, .tool-name code { padding: 0.0625rem 0.25rem; font-size: 0.875rem; letter-spacing: -0.02em; color: var(--white); background: var(--fill-code); border: 1px solid var(--line-soft); border-radius: 4px; overflow-wrap: anywhere; }
/* code block as in Neon docs: black, 1px frame, square, no prompt sign; 14/21 type, 1rem inset,
   the copy button sits mid-height on a one-line block. A long line wraps instead of scrolling,
   and only between words: a command name or flag is never split */
.code-block { position: relative; background: var(--black); border: 1px solid var(--line-strong); }
.code-block pre { margin: 0; padding: 1rem 3.5rem 1rem 1rem; font-size: 0.875rem; line-height: 1.3125rem; color: var(--code); white-space: pre-wrap; overflow-wrap: anywhere; }
.code-block :is(.tok-fn, .tok-str) { white-space: nowrap; }
.code-block .copy-square { top: min(1rem, calc(50% - 0.875rem)); }
.code-block .copy-icon { width: 0.875rem; height: 0.875rem; }
/* token colours of the docs' code theme */
.tok-fn { color: #f7b983; }
.tok-str { color: #ffed9c; }
.tok-expr { color: #af93ea; }
.tok-key { color: var(--green); }
.tok-punct { color: var(--white); }

/* ---------- part 03: parameters (a table as in Neon docs: a rule under every row, none around or between columns) ---------- */
.params-wrap { margin-bottom: 1.5rem; overflow-x: auto; }
.params { width: 100%; border-collapse: collapse; text-align: left; }
.params th { padding: 0.75rem; font-size: 0.875rem; font-weight: 500; line-height: 1.375; color: var(--white); vertical-align: top; border-bottom: 1px solid var(--line-strong); }
.params td { padding: 0.75rem; font-size: 0.875rem; line-height: 1.875; color: var(--cell); vertical-align: baseline; border-bottom: 1px solid var(--line-strong); }
.params :is(th, td):first-child { padding-left: 0; }
.params :is(th, td):last-child { padding-right: 0; }
.params td:first-child { white-space: nowrap; }

/* ---------- part 04: parts list (an accordion as in Neon docs' FAQ: no frame or fill, the arrow on
   the left, the content under the title; a rule between groups) ---------- */
.tool-groups { border-top: 1px solid var(--line-strong); }
.tool-group { border-bottom: 1px solid var(--line-strong); }
.tool-group summary { display: flex; align-items: flex-start; gap: 0.75rem; padding: 0.875rem 0; font-size: 1rem; line-height: 1.375; letter-spacing: -0.025em; color: var(--white); background: var(--black); cursor: pointer; list-style: none; }
.tool-group summary::-webkit-details-marker { display: none; }
/* the arrow: two sides of a 0.5rem square, pointing right; turned down when the group is open */
.tool-group summary::before { content: ''; position: relative; top: 0.5rem; flex: none; width: 0.5rem; height: 0.5rem; border: solid var(--muted); border-width: 1px 1px 0 0; transform: rotate(45deg); transition: transform 0.2s, border-color 0.2s; }
.tool-group summary:hover::before { border-color: var(--white); }
.tool-group[open] summary::before { transform: rotate(135deg); }
/* an open group's title parks under the head row while its tools scroll past */
.tool-group[open] summary { position: sticky; top: var(--stick); z-index: 1; box-shadow: 0 1px 0 var(--line-strong); }
.tool-group summary:focus-visible { z-index: 2; outline-offset: -2px; }
.count { font-size: 0.875rem; font-weight: 500; line-height: 1.375rem; color: var(--muted); } /* the number of tools sits right after the group name */
/* the tools line up with the title, past the arrow */
.tool-list { padding: 0 0 0.375rem 1.25rem; }
.tool { padding: 0.875rem 0; }
.tool + .tool { border-top: 1px solid var(--line); }
.tool-name { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.625rem; }
.tool-title { font-size: 1rem; color: var(--muted); }
/* badge as in Neon docs (the green "new" pill): 11px capitals on a 10% tint of their own colour.
   Capitals have no descenders, so the line is trimmed to cap height and baseline and the equal
   padding centres them; a browser without text-box keeps the docs' 4px padding */
.badge { order: 3; display: inline-block; padding: 0.25rem 0.5rem; font-size: 0.6875rem; font-weight: 400; line-height: 1.25; letter-spacing: 0.025em; text-transform: uppercase; white-space: nowrap; color: var(--badge); background: color-mix(in srgb, var(--badge) 10%, transparent); border-radius: 40px; }
@supports (text-box: trim-both cap alphabetic) {
  .badge { padding: 0.4375rem calc(0.5rem - 0.025em) 0.4375rem 0.5rem; text-box: trim-both cap alphabetic; } /* the right side gives back the last letter's tracking */
}
.tool-desc { margin-top: 0.375rem; font-size: 1rem; line-height: 1.6; color: var(--body); text-wrap: pretty; }`;

export const LANDING_PAGE_CSS = `${COMPONENTS_CSS}
${LAYOUT_CSS}`;
