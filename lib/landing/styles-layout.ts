/**
 * How the booklet is laid out at each width: blocks that respond to the width of the page they
 * sit on, the single column, the two-page spread, and the page turn.
 */
export const LAYOUT_CSS = `
/* ---------- wider page (container, not viewport: the right page is half a screen) ---------- */
@container (min-width: 30rem) {
  .tab { min-height: 2.75rem; padding: 0 0.75rem; font-size: 0.875rem; white-space: nowrap; }
  .client { padding: 1.5rem; }
  .prose { font-size: 1.0625rem; }
  .sheet-desc { margin-bottom: 1.5rem; font-size: 1.0625rem; }
  .code-block pre { padding: 0.9375rem 3.5rem 0.9375rem 1.25rem; font-size: 0.9375rem; }
  .code-block[data-lang='bash'] pre { padding-left: 2.75rem; }
  .code-block[data-lang='bash']::before { left: 1.25rem; top: 0.9375rem; font-size: 0.9375rem; }
  .param dd { font-size: 1.0625rem; }
  .tool-group summary { grid-template-columns: minmax(0, 1fr) auto 1rem; padding: 0.5rem 1.125rem; }
  .tool { padding: 0.875rem 1.125rem; }
}
@container (min-width: 34rem) {
  .param { grid-template-columns: 11.5rem minmax(0, 1fr); }
  .param dt { padding: 0.875rem 1.125rem; border-right: 1px solid var(--line-strong); border-bottom: 0; }
  .param dd { padding: 0.875rem 1.125rem; }
}
@container (min-width: 46rem) {
  .tabs-row { display: flex; flex-wrap: wrap; }
  .tab { flex: 1 1 auto; padding: 0 1rem; }
}

/* ---------- single-page mode with script: one page at a time ---------- */
@media (max-width: 59.9375rem) {
  /* single column: the cover stays on top of every part, the parts are tabs under it */
  .book > .cover { order: 0; }
  .book > .bar { order: 1; }
  .book > .leaves { order: 2; }
  .toc, .cover-foot { display: none; }
  .cover { border-bottom: 1px solid var(--line-strong); }
  html.js .sheet { display: none; border-bottom: 0; }
  .folio { display: none; } /* the part strip is the only navigation here */
}
@media (max-width: 47.9375rem) {
  :root { --pad: 1rem; }
  .cover-head { height: 3.25rem; }
}
@media (min-width: 48rem) and (max-width: 59.9375rem) {
  :root { --pad: 1.5rem; }
  .bar-nav { padding: 0 0.875rem; }
  .cover-main { padding-top: 2.75rem; }
  .cover-main > * { max-width: 40rem; }
  .hero-description { font-size: 1.125rem; }
  .url-field code { font-size: 1.25rem; }
}

/* ---------- the spread ---------- */
@media (min-width: 60rem) {
  :root { --pad: 1.5rem; --stick: var(--head); }
  .bar { display: none; }
  .book { grid-template-columns: 24rem minmax(0, 1fr) var(--tabs); max-width: calc(84rem + 2 * var(--tabs)); margin: 0 auto; }
  .cover { position: sticky; top: 0; z-index: 3; align-self: start; height: 100svh; border-right: 1px solid var(--line-strong); border-bottom: 0; }
  /* a very short window: the left page scrolls inside itself rather than letting go of the URL */
  .cover-body { overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--line-control) transparent; }
  .cover-main { padding: 2rem var(--pad) 1.5rem; }
  .cover h1 { font-size: 2rem; }
  .url-field { padding-left: 0.875rem; padding-right: 3.5rem; }
  .url-field code { font-size: 1rem; }
  .toc { margin-top: auto; padding-top: 2rem; }
  .cover-foot { justify-content: flex-end; }
  .leaves { border-right: 1px solid var(--line-strong); }
  .sheet { min-height: 100svh; }
  .sheet-head { position: sticky; top: 0; z-index: 4; height: var(--head); padding: 0 var(--pad); border-bottom: 1px solid var(--line-strong); }
  .sheet-body { padding: 2.625rem var(--pad) 2.5rem; } /* heading's cap line sits on the cover label's cap line */
  .folio { position: sticky; bottom: 0; z-index: 4; height: var(--foot); padding: 0 var(--pad); }
  /* registration crosses where the spine meets the head and foot rules (source mark) */
  .sheet-head::before, .folio::before { content: ''; position: absolute; left: -5px; z-index: 5; width: 9px; height: 9px; background: linear-gradient(var(--mark), var(--mark)) center / 1px 100% no-repeat, linear-gradient(var(--mark), var(--mark)) center / 100% 1px no-repeat; pointer-events: none; }
  .sheet-head::before { bottom: -5px; }
  .folio::before { top: -5px; }

  html.js .sheet { display: none; }

  /* thumb index on the fore-edge */
  .thumbs { position: sticky; top: 0; display: flex; flex-direction: column; align-self: start; height: 100svh; padding-top: var(--head); }
  .thumbs a { display: grid; place-items: center; width: var(--tabs); height: 4.5rem; margin-top: -1px; font: 500 0.8125rem/1 var(--mono); letter-spacing: 0; color: var(--body); border: solid var(--line-strong); border-width: 1px 1px 1px 0; transition: color 0.2s, background-color 0.2s; }
  .thumbs a:hover { color: var(--white); background: var(--raised); }
  .thumbs a[aria-current='page'] { color: var(--black); background: var(--white); border-color: var(--white); }
  html:not(.js) .thumbs a { border-color: var(--line-strong); }
}
@media (min-width: 80rem) {
  :root { --pad: 2.25rem; }
  .book { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) var(--tabs); padding-left: var(--tabs); }
  .cover { border-left: 1px solid var(--line-strong); }
  .cover-body { grid-template-columns: 4.5rem minmax(0, 1fr); grid-template-rows: 1fr; }
  .cover-hatch { height: auto; border-right: 1px solid var(--line-strong); border-bottom: 0; }
  .cover-head { padding-left: calc(4.5rem + 2rem); }
  .cover-main { padding: 2.75rem var(--pad) 2.5rem 2rem; }
  .cover-foot { justify-content: flex-start; padding-left: calc(4.5rem + 2rem); }
  .cover h1 { font-size: 3rem; }
  .hero-description { font-size: 1.125rem; }
  .hero-connect { max-width: 30rem; margin-top: 1.75rem; }
  .url-field { padding: 0.5rem 4rem 0.5rem 1.125rem; }
  .url-field code { font-size: 1.25rem; }
}

/* ---------- the turn (interactions.ts) ---------- */
.is-leaf { display: flex !important; position: fixed !important; z-index: 30; margin: 0 !important; overflow: hidden; border-left: 1px solid var(--line-strong); border-right: 1px solid var(--line-strong); will-change: transform; }
.is-under { display: flex !important; position: fixed !important; z-index: 1; margin: 0 !important; overflow: hidden; }
.is-rising { z-index: 30; will-change: transform; outline: 1px solid var(--line-strong); }
.verso { position: fixed; z-index: 31; background: var(--well) repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0 1px, transparent 1px 8px); border: 1px solid var(--line-control); pointer-events: none; will-change: transform, opacity; }

@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; }
}

/* which part and which client procedure are open is set on <html> before first paint;
   the rules that show them are generated from the content ids (page.ts) */
html.js .client { display: none; }

/* without script the parts follow each other down the right-hand side */
html:not(.js) .sheet { min-height: 0; }`;
