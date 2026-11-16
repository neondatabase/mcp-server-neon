import he from 'he';
import { Marked } from 'marked';
import { OAUTH_PAGE_FONT_LINKS } from '../../mcp/oauth/page-shell';
import { SERVER_INFO } from '../server-metadata';
import {
  ACCESS_BLOCK,
  ACCESS_NOTES,
  ACCESS_PARAMS,
  API_KEY_BLOCK,
  INSTALL_SECTION,
  INSTALL_TABS,
  TOOLS_SECTION,
} from './content';
import { COPY_ICONS, INTERACTION_SCRIPT } from './interactions';
import {
  DOCS_URL,
  MARKDOWN_PATH,
  MCP_URL,
  OG_IMAGE_URL,
  REPOSITORY_URL,
  STATUS_URL,
} from './links';
import { LANDING_PAGE_CSS } from './styles';
import { TOOL_GROUPS_HTML } from './tools';

const APP_LINK = /^(?:cursor|vscode|vscode-insiders):/u;

const LABEL_ARROW =
  '<svg viewBox="0 0 12 14" width="12" height="14" aria-hidden="true"><path d="M12 7L3 12.1962L3 1.80385L12 7Z" fill="currentColor"/></svg>';

const ARROW_RIGHT =
  '<svg viewBox="0 0 16 12" width="16" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" aria-hidden="true"><path d="M11.108 10.921L15 7.03l-3.892-3.892"/><path d="M0.938 7.032h12.728"/></svg>';

const external = (href: string): string =>
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

const prose = (source: string): string =>
  `<div class="prose">${markdown.parse(source, { async: false })}</div>`;

const inline = (source: string): string =>
  markdown.parseInline(source, { async: false });

type SectionCopy = {
  id: string;
  title: string;
  description: string;
};

type PageSection = SectionCopy & { nav: string };

const INSTALL: PageSection = { ...INSTALL_SECTION, nav: 'Install' };
const API_KEY: PageSection = { ...API_KEY_BLOCK, nav: 'API key' };
const ACCESS: PageSection = { ...ACCESS_BLOCK, nav: 'Limit access' };
const TOOLS: PageSection = { ...TOOLS_SECTION, nav: 'Tools' };

/** The sections in page order; a section's number is its place in this list. */
const SECTIONS: readonly PageSection[] = [INSTALL, API_KEY, ACCESS, TOOLS];

const sectionNumber = (id: string): string =>
  String(SECTIONS.findIndex((section) => section.id === id) + 1).padStart(
    2,
    '0',
  );

/** One ledger row: the section's number and short name in the margin, its content beside it. */
const sheet = (
  { id, title, description, nav }: PageSection,
  content: string,
): string => `
    <section class="sheet" id="${id}" aria-labelledby="${id}-title">
      <p class="margin" aria-hidden="true"><span class="margin-label"><span class="num">${sectionNumber(id)}</span><span>${nav}</span></span></p>
      <div class="sheet-body">
        <h2 id="${id}-title">${title}</h2>
        <p class="sheet-desc">${description}</p>
        ${content}
      </div>
    </section>`;

const HEADER = `
  <header class="site-header frame">
    <div class="header-inner">
      <a class="logo" ${external('https://neon.com')}><img src="/images/landing/neon-logo.svg" alt="Neon" width="88" height="24"></a>
      <span class="product-tag">MCP</span>
      <nav class="site-nav" aria-label="Sections">
        ${SECTIONS.map(({ id, nav }) => `<a href="#${id}">${nav}</a>`).join('')}
      </nav>
      <a class="header-link" ${external(DOCS_URL)}>Docs</a>
      <button type="button" class="btn btn-primary btn-sm copy-btn" data-copy="${he.escape(MCP_URL)}" aria-label="Copy MCP server URL">${COPY_ICONS}<span class="copy-label">Copy URL</span></button>
    </div>
  </header>`;

const HERO = `
    <section class="sheet hero" aria-labelledby="hero-title">
      <div class="margin hero-hatch" aria-hidden="true"></div>
      <div class="sheet-body">
        <p class="label">${LABEL_ARROW}<span>Model Context Protocol</span></p>
        <h1 id="hero-title">Neon MCP Server <span class="version">v${he.escape(SERVER_INFO.version)}</span></h1>
        <p class="hero-description">${he.escape(SERVER_INFO.description ?? '')}</p>
        <div class="hero-connect">
          <p class="field-label" id="url-label">MCP server URL</p>
          <a class="docs-link" ${external(DOCS_URL)}>Read the docs${ARROW_RIGHT}</a>
          <div class="url-field" role="group" aria-labelledby="url-label">
            <code>${he.escape(MCP_URL)}</code>
            <button type="button" class="copy-btn copy-square" data-copy="${he.escape(MCP_URL)}" data-top-task aria-label="Copy MCP server URL" title="Copy MCP server URL">${COPY_ICONS}</button>
          </div>
        </div>
      </div>
    </section>`;

const tabsHtml = INSTALL_TABS.map(
  ({ id, label }, index) =>
    `<button type="button" class="tab" role="tab" id="tab-${id}" aria-controls="panel-${id}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}">${label}</button>`,
).join('');

const panelsHtml = INSTALL_TABS.map(
  ({ id, body }, index) =>
    `<div class="tab-panel" role="tabpanel" id="panel-${id}" aria-labelledby="tab-${id}"${index === 0 ? '' : ' hidden'}>${prose(body)}</div>`,
).join('');

const accessParams = `<dl class="params">${ACCESS_PARAMS.map(
  ({ param, effect }) =>
    `<div class="param"><dt><code>${he.escape(param)}</code></dt><dd>${inline(effect)}</dd></div>`,
).join('')}</dl>`;

const FOOTER = `
    <footer class="footer">
      <a class="logo" ${external('https://neon.com')}><img src="/images/landing/neon-logo.svg" alt="Neon" width="88" height="24"></a>
      <nav class="footer-links" aria-label="Resources">
        <a ${external(DOCS_URL)}>Docs</a>
        <a ${external(REPOSITORY_URL)}>GitHub</a>
        <a ${external(STATUS_URL)}>Status</a>
      </nav>
    </footer>`;

const BODY = `${HEADER}
<div class="frame page">
  <main>
    ${HERO}
    ${sheet(INSTALL, `<div class="tabs-row" role="tablist" aria-label="MCP clients">${tabsHtml}</div>${panelsHtml}`)}
    ${sheet(API_KEY, prose(API_KEY_BLOCK.body))}
    ${sheet(ACCESS, `${accessParams}${prose(ACCESS_NOTES)}`)}
    ${sheet(TOOLS, `<div class="tool-groups">${TOOL_GROUPS_HTML}</div>`)}
  </main>
  ${FOOTER}
</div>`;

const TITLE = 'Neon MCP Server — Connect with Claude Code, Cursor & VS Code';

const DESCRIPTION = he.escape(SERVER_INFO.description ?? TITLE);

const HEAD = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#000000">
<title>${TITLE}</title>
<meta name="description" content="${DESCRIPTION}">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${DESCRIPTION}">
<meta property="og:type" content="website">
<meta property="og:image" content="${OG_IMAGE_URL}">
<meta name="twitter:card" content="summary_large_image">
<link rel="alternate" type="text/markdown" href="${MARKDOWN_PATH}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
${OAUTH_PAGE_FONT_LINKS}
<link rel="stylesheet" href="/fonts/geist-mono/geist-mono.css">`;

export const renderLandingPage = (nonce: string): string => `<!DOCTYPE html>
<html lang="en">
<head>
${HEAD}
<style nonce="${nonce}">${LANDING_PAGE_CSS}</style>
</head>
<body>
${BODY}
<script nonce="${nonce}">${INTERACTION_SCRIPT}</script>
</body>
</html>`;
