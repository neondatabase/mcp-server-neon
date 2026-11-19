import he from 'he';
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
import {
  COPY_ICONS,
  INTERACTION_SCRIPT,
  openAtAddressScript,
} from './interactions';
import {
  DOCS_URL,
  MARKDOWN_PATH,
  MCP_URL,
  OG_IMAGE_URL,
  REPOSITORY_URL,
  STATUS_URL,
} from './links';
import {
  ARROW_RIGHT,
  LABEL_ARROW,
  external,
  inline,
  prose,
  steps,
} from './markup';
import { LANDING_PAGE_CSS } from './styles';
import { SCOPE_CATEGORIES } from '../../mcp/utils/grant-context';
import { TOOL_GROUPS_HTML, toolGroupAnchor } from './tools';

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

/** The parts in page order; a part's number is its place in this list. */
const SECTIONS: readonly PageSection[] = [INSTALL, API_KEY, ACCESS, TOOLS];

const sectionNumber = (id: string): string =>
  String(SECTIONS.findIndex((section) => section.id === id) + 1).padStart(
    2,
    '0',
  );

/** The address of one client's procedure inside the install part. */
const clientAnchor = (id: string): string => `${INSTALL.id}-${id}`;

const turnLink = (
  section: PageSection | undefined,
  direction: 'prev' | 'next',
): string => {
  if (section === undefined) {
    return '';
  }

  const label = `<span>${section.nav}</span>`;

  return `<a class="btn btn-outline turn turn-${direction}" href="#${section.id}" rel="${direction}">${direction === 'prev' ? `${ARROW_RIGHT}${label}` : `${label}${ARROW_RIGHT}`}</a>`;
};

/** One right-hand page: its number and short name at the head, the content, the folio at the foot. */
const sheet = (section: PageSection, content: string): string => {
  const { id, title, description, nav } = section;
  const index = SECTIONS.indexOf(section);

  return `
      <article class="sheet" id="${id}" aria-labelledby="${id}-title" data-sheet>
        <div class="sheet-head">
          <p class="margin-label" aria-hidden="true"><span class="num">${sectionNumber(id)}</span><span>${nav}</span></p>
        </div>
        <div class="sheet-body">
          <h2 id="${id}-title" tabindex="-1">${title}</h2>
          <p class="sheet-desc">${description}</p>
          ${content}
        </div>
        <nav class="folio" aria-label="Pages, from ${nav}">
          ${turnLink(SECTIONS[index - 1], 'prev')}
          <p class="page-no"><span class="sr-only">Page </span><b>${index + 1}</b> / ${SECTIONS.length}</p>
          ${turnLink(SECTIONS[index + 1], 'next')}
        </nav>
      </article>`;
};

const LOGO = `<a class="logo" ${external('https://neon.com')}><img src="/images/landing/neon-logo.svg" alt="Neon" width="88" height="24"></a>`;

/** Single column only: the parts as a strip under the cover. */
const PART_STRIP = `
    <div class="bar">
      <nav class="bar-nav" aria-label="Parts">
        ${SECTIONS.map(({ id, nav }) => `<a href="#${id}" data-part-link="${id}">${nav}</a>`).join('')}
      </nav>
    </div>`;

const CONTENTS = `
          <nav class="toc" aria-labelledby="contents-label">
            <p class="field-label" id="contents-label">Contents</p>
            <ol>
              ${SECTIONS.map(
                ({ id, title }) =>
                  `<li><a href="#${id}" data-part-link="${id}"><span class="here" aria-hidden="true"></span><span>${title}</span><span class="leader" aria-hidden="true"></span><span class="num">${sectionNumber(id)}</span></a></li>`,
              ).join('')}
            </ol>
          </nav>`;

/** The left page. It never turns: what this is, the permanent URL, the contents. */
const COVER = `
    <header class="cover" id="cover">
      <div class="cover-head">
        ${LOGO}
        <span class="product-tag">MCP</span>
      </div>
      <div class="cover-body">
        <div class="cover-hatch" aria-hidden="true"></div>
        <div class="cover-main">
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
          ${CONTENTS}
        </div>
      </div>
      <footer class="cover-foot">
        <nav class="footer-links" aria-label="Resources">
          <a ${external(DOCS_URL)}>Docs</a>
          <a ${external(REPOSITORY_URL)}>GitHub</a>
          <a ${external(STATUS_URL)}>Status</a>
        </nav>
      </footer>
    </header>`;

/** The fore-edge index: the same four links as the contents, so it stays out of the tab order. */
const THUMB_INDEX = `
    <nav class="thumbs" aria-hidden="true">
      ${SECTIONS.map(({ id, nav }) => `<a href="#${id}" data-part-link="${id}" tabindex="-1" title="${sectionNumber(id)} ${nav}">${sectionNumber(id)}</a>`).join('')}
    </nav>`;

/** Links until script upgrades them to a tab list; without script every procedure is printed. */
const clientLinks = INSTALL_TABS.map(
  ({ id, label }) =>
    `<a class="tab" href="#${clientAnchor(id)}" data-client-link="${id}"><span>${label}</span></a>`,
).join('');

const clientPanels = INSTALL_TABS.map(
  ({ id, label, body, sequence }) =>
    `<section class="client" id="${clientAnchor(id)}" data-client="${id}" aria-labelledby="client-${id}"><h3 class="client-title" id="client-${id}">${label}</h3>${sequence === true ? steps(body) : prose(body)}</section>`,
).join('');

/** Each category value in the parameter table points at that category's tools. */
const linkCategories = (html: string): string =>
  SCOPE_CATEGORIES.reduce(
    (linked, category) =>
      linked.replace(
        `<code>${category}</code>`,
        `<a href="#${toolGroupAnchor(category)}"><code>${category}</code></a>`,
      ),
    html,
  );

const accessParams = `<dl class="params">${ACCESS_PARAMS.map(
  ({ param, effect }) =>
    `<div class="param"><dt><code>${he.escape(param)}</code></dt><dd>${linkCategories(inline(effect))}</dd></div>`,
).join('')}</dl>`;

const BODY = `<div class="desk">
  <div class="book">
    ${PART_STRIP}
    ${COVER}
    <main class="leaves">
      ${sheet(INSTALL, `<div><nav class="tabs-row" aria-label="MCP clients" data-clients>${clientLinks}</nav>${clientPanels}</div>`)}
      ${sheet(API_KEY, prose(API_KEY_BLOCK.body))}
      ${sheet(ACCESS, `${accessParams}${prose(ACCESS_NOTES)}`)}
      ${sheet(TOOLS, `<div class="tool-groups">${TOOL_GROUPS_HTML}</div>`)}
    </main>
    ${THUMB_INDEX}
  </div>
</div>`;

const PART_IDS = SECTIONS.map(({ id }) => id);

const CLIENT_IDS = INSTALL_TABS.map(({ id }) => id);

/** Which part and which client procedure are open, by the attributes the head script sets. */
const OPEN_CSS = [
  `${PART_IDS.map((id) => `html.js[data-part='${id}'] #${id}`).join(', ')} { display: flex; }`,
  `${CLIENT_IDS.map((id) => `html.js[data-client='${id}'] #${clientAnchor(id)}`).join(', ')} { display: block; }`,
].join('\n');

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

const OPEN_AT_ADDRESS = openAtAddressScript(
  PART_IDS,
  CLIENT_IDS.map((id) => [clientAnchor(id), id]),
);

export const renderLandingPage = (nonce: string): string => `<!DOCTYPE html>
<html lang="en">
<head>
${HEAD}
<script nonce="${nonce}">${OPEN_AT_ADDRESS}</script>
<style nonce="${nonce}">${LANDING_PAGE_CSS}
${OPEN_CSS}</style>
</head>
<body>
${BODY}
<script nonce="${nonce}">${INTERACTION_SCRIPT}</script>
</body>
</html>`;
