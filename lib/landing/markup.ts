import he from 'he';
import { Marked } from 'marked';
import { COPY_ICONS } from './interactions';

const APP_LINK = /^(?:cursor|vscode|vscode-insiders):/u;

export const LABEL_ARROW =
  '<svg viewBox="0 0 12 14" width="12" height="14" aria-hidden="true"><path d="M12 7L3 12.1962L3 1.80385L12 7Z" fill="currentColor"/></svg>';

export const ARROW_RIGHT =
  '<svg viewBox="0 0 16 12" width="16" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" aria-hidden="true"><path d="M11.108 10.921L15 7.03l-3.892-3.892"/><path d="M0.938 7.032h12.728"/></svg>';

export const external = (href: string): string =>
  `href="${he.escape(href)}" target="_blank" rel="noopener noreferrer"`;

const copyButton = (text: string, label = 'Copy'): string =>
  `<button type="button" class="copy-btn copy-square" data-copy="${he.escape(text)}" aria-label="${label}" title="${label}">${COPY_ICONS}</button>`;

const keepFlagsWhole = (html: string): string =>
  html.replaceAll(
    /(?<lead>^|\s)(?<flag>-[^\s]+)/gu,
    '$<lead><span class="nowrap">$<flag></span>',
  );

const markdown = new Marked({
  renderer: {
    code: ({ text, lang }) =>
      `<div class="code-block" data-lang="${he.escape(lang ?? 'text')}"><pre><code>${keepFlagsWhole(he.escape(text))}</code></pre>${copyButton(text)}</div>`,
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

/**
 * A body whose paragraphs are done in order, set as numbered steps: each paragraph opens a step
 * and the code blocks after it belong to that step.
 */
export const steps = (source: string): string => {
  const groups: string[][] = [];

  for (const block of source.split('\n\n')) {
    const current = groups.at(-1);

    if (current === undefined || !block.startsWith('```')) {
      groups.push([block]);
    } else {
      current.push(block);
    }
  }

  return `<div class="prose"><ol>${groups
    .map(
      (group) =>
        `<li>${markdown.parse(group.join('\n\n'), { async: false })}</li>`,
    )
    .join('')}</ol></div>`;
};
