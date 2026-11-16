import he from 'he';
import { Marked } from 'marked';
import { OAUTH_PAGE_FONT_LINKS } from '../../mcp/oauth/page-shell';
import { SERVER_INFO } from '../server-metadata';
import {
  BLOCKS,
  INSTALL_SECTION,
  INSTALL_TABS,
  TOOLS_SECTION,
} from './content';
import { HERO_VIDEO_HTML, HERO_VIDEO_SCRIPT } from './hero-video';
import { COPY_ICON, INTERACTION_SCRIPT } from './interactions';
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

const LINE_INTERSECTION_PATH =
  'M10.5 4C10.5 7.31371 7.81371 10 4.5 10H0.5V11H4.5C7.81371 11 10.5 13.6863 10.5 17V21H11.5V17C11.5 13.6863 14.1863 11 17.5 11H21.5V10H17.5C14.1863 10 11.5 7.31371 11.5 4V0H10.5V4Z';

const APP_LINK = /^(?:cursor|vscode|vscode-insiders):/u;

const external = (href: string): string =>
  `href="${he.escape(href)}" target="_blank" rel="noopener noreferrer"`;

const copyButton = (text: string, label = 'Copy'): string =>
  `<button type="button" class="copy-btn" data-copy="${he.escape(text)}" aria-label="${label}">${COPY_ICON}</button>`;

const keepFlagsWhole = (html: string): string =>
  html.replaceAll(
    /(?<lead>^|\s)(?<flag>-[^\s]+)/gu,
    '$<lead><span class="nowrap">$<flag></span>',
  );

const markdown = new Marked({
  renderer: {
    code: ({ text }) =>
      `<div class="code-block"><pre><code>${keepFlagsWhole(he.escape(text))}</code></pre>${copyButton(text)}</div>`,
    link: ({ href, text }) =>
      APP_LINK.test(href)
        ? `<a class="btn btn-primary" href="${he.escape(href)}">${he.escape(text)}</a>`
        : `<a ${external(href)}>${he.escape(text)}</a>`,
    html: ({ text }) => he.escape(text),
  },
});

const prose = (source: string): string =>
  `<div class="prose">${markdown.parse(source, { async: false })}</div>`;

const corner = (position: string): string =>
  `<svg class="corner corner-${position}" viewBox="0 0 22 21" fill="none" aria-hidden="true"><path d="${LINE_INTERSECTION_PATH}" fill="currentColor"/></svg>`;

const FRAME = `<div class="rail rail-left"></div><div class="rail rail-right"></div><div class="rail rail-top"></div><div class="rail rail-bottom"></div>
  ${['tl', 'tr', 'bl', 'br'].map((position) => corner(position)).join('')}`;

type CardCopy = {
  id: string;
  title: string;
  description: string;
};

const card = (copy: CardCopy, content: string): string => `
  <section class="card" aria-labelledby="${copy.id}-title">
    <div class="card-header">
      <h2 class="card-title" id="${copy.id}-title">${copy.title}</h2>
      <p class="card-desc">${copy.description}</p>
    </div>
    <div class="card-content">${content}</div>
  </section>`;

const HERO = `
  <header class="card">
    <div class="hero-media">
      ${HERO_VIDEO_HTML}
      <div class="hero-inner">
        <a class="hero-logo" ${external('https://neon.com')}><img src="/images/landing/neon-logo.svg" alt="Neon" width="102" height="28"></a>
        <h1 id="hero-title">Neon MCP Server <span class="version">v${he.escape(SERVER_INFO.version)}</span></h1>
        <p class="hero-description">${he.escape(SERVER_INFO.description ?? '')}</p>
        <div class="url-pill"><code>${he.escape(MCP_URL)}</code>${copyButton(MCP_URL, 'Copy MCP server URL')}</div>
        <a class="btn btn-primary" ${external(DOCS_URL)}>Read the docs</a>
      </div>
    </div>
  </header>`;

const tabsHtml = INSTALL_TABS.map(
  ({ id, label }, index) =>
    `<button type="button" class="tab" role="tab" id="tab-${id}" aria-controls="panel-${id}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}">${label}</button>`,
).join('');

const panelsHtml = INSTALL_TABS.map(
  ({ id, body }, index) =>
    `<div role="tabpanel" id="panel-${id}" aria-labelledby="tab-${id}"${index === 0 ? '' : ' hidden'}>${prose(body)}</div>`,
).join('');

const FOOTER = `
  <footer class="footer">
    <a ${external('https://neon.com')}><img src="/images/landing/neon-logo.svg" alt="Neon" width="88" height="24"></a>
    <nav class="footer-links" aria-label="Resources">
      <a ${external(DOCS_URL)}>Docs</a>
      <a ${external(REPOSITORY_URL)}>GitHub</a>
      <a ${external(STATUS_URL)}>Status</a>
    </nav>
  </footer>`;

const BODY = `<div class="layout">
  ${FRAME}
  ${HERO}
  ${card(INSTALL_SECTION, `<div class="tabs-row" role="tablist" aria-label="MCP clients">${tabsHtml}</div>${panelsHtml}`)}
  ${BLOCKS.map((block) => card(block, prose(block.body))).join('')}
  ${card(TOOLS_SECTION, TOOL_GROUPS_HTML)}
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
${OAUTH_PAGE_FONT_LINKS}`;

export const renderLandingPage = (nonce: string): string => `<!DOCTYPE html>
<html lang="en">
<head>
${HEAD}
<style nonce="${nonce}">${LANDING_PAGE_CSS}</style>
</head>
<body>
${BODY}
<script nonce="${nonce}">${HERO_VIDEO_SCRIPT}</script>
<script nonce="${nonce}">${INTERACTION_SCRIPT}</script>
</body>
</html>`;
