import he from 'he';
import { Marked } from 'marked';
import { highlight } from './highlight';
import { COPY_ICONS } from './interactions';

const APP_LINK = /^(?:cursor|vscode|vscode-insiders):/u;

export const external = (href: string): string =>
  `href="${he.escape(href)}" target="_blank" rel="noopener noreferrer"`;

/** A code block as Neon docs draw it, with a button that copies exactly the text shown. */
export const codeBlock = (
  text: string,
  language?: string,
  label = 'Copy',
): string =>
  `<div class="code-block"><pre><code>${highlight(text, language)}</code></pre><button type="button" class="copy-btn" aria-label="${he.escape(label)}" title="${he.escape(label)}" hidden>${COPY_ICONS}</button></div>`;

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
