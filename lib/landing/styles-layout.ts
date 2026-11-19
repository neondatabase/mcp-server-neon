/**
 * How the booklet is laid out at each width: blocks that respond to the width of the page they
 * sit on, the single column, and the two-page spread.
 */
export const LAYOUT_CSS = `
/* ---------- wider page (container, not viewport: the right page is half a screen) ---------- */
@container (min-width: 30rem) {
  .tab { min-height: 2.75rem; padding: 0 0.75rem; font-size: 0.875rem; white-space: nowrap; }
  .client { padding: 1.5rem; }
  .prose { font-size: 1.0625rem; }
  .sheet-desc { margin-bottom: 1.5rem; font-size: 1.0625rem; }
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

/* ---------- single column: cover, then the part strip, then the parts ---------- */
@media (max-width: 59.9375rem) {
  .book > .cover { order: 0; }
  .book > .bar { order: 1; }
  .book > .leaves { order: 2; }
  .toc, .cover-foot { display: none; }
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
  .book { grid-template-columns: 24rem minmax(0, 1fr); max-width: 84rem; margin: 0 auto; }
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
  /* the head row: one for the whole sheet, parked at the top; only its text changes */
  .sheet-head { position: sticky; top: 0; z-index: 4; display: flex; align-items: center; height: var(--head); padding: 0 var(--pad); background: var(--black); border-bottom: 1px solid var(--line-strong); }
  /* without script it cannot follow the reader: it stays where it is true, above part 01 */
  html:not(.js) .sheet-head { position: relative; }
  html:not(.js) { --stick: 0px; }
  .sheet-body { padding: 2.625rem var(--pad) 2.5rem; } /* heading's cap line sits on the cover label's cap line */
  /* registration cross where the spine meets the head rule (source mark) */
  .sheet-head::before { content: ''; position: absolute; left: -5px; z-index: 5; width: 9px; height: 9px; background: linear-gradient(var(--mark), var(--mark)) center / 1px 100% no-repeat, linear-gradient(var(--mark), var(--mark)) center / 100% 1px no-repeat; bottom: -5px; pointer-events: none; }

}
@media (min-width: 80rem) {
  :root { --pad: 2.25rem; }
  .book { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
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

/* anchors glide once the page has opened (ready is set after load, so opening at an address is a plain jump) */
@media (prefers-reduced-motion: no-preference) {
  html.ready { scroll-behavior: smooth; }
}
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; }
}

/* which client procedure is shown is set on <html> before first paint; the rule that shows it is
   generated from the client ids (page.ts) */
html.js .client { display: none; }`;
