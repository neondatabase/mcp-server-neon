import he from 'he';
import { Marked } from 'marked';
import { highlight } from './highlight';
import { COPY_ICONS } from './interactions';

const APP_LINK = /^(?:cursor|vscode|vscode-insiders):/u;

export const LABEL_ARROW =
  '<svg viewBox="0 0 12 14" width="12" height="14" aria-hidden="true"><path d="M12 7L3 12.1962L3 1.80385L12 7Z" fill="currentColor"/></svg>';

export const external = (href: string): string =>
  `href="${he.escape(href)}" target="_blank" rel="noopener noreferrer"`;

/** A code block as Neon docs draw it, with a button that copies exactly the text shown. */
export const codeBlock = (
  text: string,
  language?: string,
  label = 'Copy',
): string =>
  `<div class="code-block"><pre><code>${highlight(text, language)}</code></pre><button type="button" class="copy-btn copy-square" data-copy="${he.escape(text)}" aria-label="${label}" title="${label}">${COPY_ICONS}</button></div>`;

const markdown = new Marked({
  renderer: {
    code: ({ text, lang }) => codeBlock(text, lang),
    link: ({ href, text }) =>
      APP_LINK.test(href)
        ? `<a class="btn btn-primary" href="${he.escape(href)}">${he.escape(text)}</a>`
        : `<a ${external(href)}>${he.escape(text)}</a>`,
    html: ({ text }) => he.escape(text),
  },
});

export const prose = (source: string): string =>
  `<div class="prose">${markdown.parse(source, { async: false })}</div>`;

export const inline = (source: string): string =>
  markdown.parseInline(source, { async: false });
