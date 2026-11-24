import he from 'he';
import { OAUTH_PAGE_FONT_LINKS } from '../../mcp/oauth/page-shell';
import { SERVER_INFO } from '../server-metadata';
import {
  ACCESS_NOTES,
  ACCESS_PARAMS,
  API_KEY_BODY,
  HERO_LEAD,
  INSTALL_PART,
  INSTALL_TABS,
  PARTS,
  paramEffect,
} from './content';
import type { PartId } from './content';
import { INTERACTION_SCRIPT, openAtAddressScript } from './interactions';
import {
  DOCS_URL,
  MARKDOWN_PATH,
  MCP_URL,
  OG_IMAGE_URL,
  REPOSITORY_URL,
  STATUS_URL,
} from './links';
import { codeBlock, external, prose } from './markup';
import { LANDING_PAGE_CSS } from './styles';
import { TOOL_GROUPS_HTML, toolGroupAnchor } from './tools';

/** The address of one client's procedure inside the install part. */
const clientAnchor = (id: string): string => `${INSTALL_PART.id}-${id}`;

/** One part of the long right-hand sheet. A rule divides it from the next. */
const sheet = (
  { id, title, description }: (typeof PARTS)[number],
  content: string,
): string => `
      <article class="sheet" id="${id}" aria-labelledby="${id}-title">
        <div class="sheet-body">
          <h2 id="${id}-title">${title}</h2>
          <p class="sheet-desc">${description}</p>
          ${content}
        </div>
      </article>`;

/**
 * The one head row of the right-hand sheet. It stays at the top and names the part in view, by
 * CSS from data-part on <html>. Decorative; every part has its own heading.
 */
const SHEET_HEAD = `
      <div class="sheet-head" aria-hidden="true">
        <p class="margin-label">${PARTS.map(({ id, title }) => `<span data-head="${id}"><span class="head-mark"></span><span>${title}</span></span>`).join('')}</p>
      </div>`;

const LOGO = `<a class="logo" ${external('https://neon.com')}><img src="/images/landing/neon-logo.svg" alt="Neon" width="88" height="24"></a>`;

const LABEL_ARROW =
  '<svg viewBox="0 0 12 14" width="12" height="14" aria-hidden="true"><path d="M12 7L3 12.1962L3 1.80385L12 7Z" fill="currentColor"/></svg>';

/** Single column only: the parts as a sticky strip under the cover. */
const PART_STRIP = `
    <div class="bar">
      <nav class="bar-nav" aria-label="Parts">
        ${PARTS.map(({ id, nav }) => `<a href="#${id}">${nav}</a>`).join('')}
      </nav>
    </div>`;

/** Docs, GitHub, Status. Printed twice: at the foot of the left page, shown on the spread, and at
 * the end of the page, shown in the single column; the other copy is not displayed. */
const footer = (where: 'cover' | 'page'): string => `
      <footer class="cover-foot ${where}-foot">
        <nav class="footer-links" aria-label="Resources">
          <a ${external(DOCS_URL)}>Docs</a>
          <a ${external(REPOSITORY_URL)}>GitHub</a>
          <a ${external(STATUS_URL)}>Status</a>
        </nav>
      </footer>`;

/** The left page. It stays put while the sheet scrolls: what this is and the permanent URL. */
const COVER = `
    <header class="cover">
      <div class="cover-head">
        ${LOGO}
      </div>
      <div class="cover-body">
        <div class="cover-main">
          <p class="label">${LABEL_ARROW}<span>Model Context Protocol</span></p>
          <h1 id="hero-title">Neon MCP Server <span class="version">v${he.escape(SERVER_INFO.version)}</span></h1>
          <p class="hero-description">${he.escape(HERO_LEAD)}</p>
          <div class="hero-connect" role="group" aria-label="MCP server URL">${codeBlock(MCP_URL, undefined, 'Copy MCP server URL')}</div>
        </div>
      </div>
      ${footer('cover')}
    </header>`;

/** Links until script upgrades them to a tab list; without script every procedure is printed. */
const clientLinks = INSTALL_TABS.map(
  ({ id, label }) =>
    `<a class="tab" id="tab-${id}" href="#${clientAnchor(id)}">${label}</a>`,
).join('');

const clientPanels = INSTALL_TABS.map(
  ({ id, label, body }) =>
    `<section class="client" id="${clientAnchor(id)}" aria-labelledby="client-${id}"><h3 class="client-title" id="client-${id}">${label}</h3>${prose(body)}</section>`,
).join('');

/** A tool category in the parameter table, pointing at that category's tools. */
const categoryLink = (category: string): string =>
  `<a href="#${toolGroupAnchor(category)}"><code>${he.escape(category)}</code></a>`;

const accessParams = `<div class="params-wrap"><table class="params"><thead><tr><th scope="col">Parameter</th><th scope="col">What it does</th></tr></thead><tbody>${ACCESS_PARAMS.map(
  (param) =>
    `<tr><td><code>${he.escape(param.param)}</code></td><td>${paramEffect({ ...param, effect: he.escape(param.effect) }, categoryLink)}</td></tr>`,
).join('')}</tbody></table></div>`;

/** What each part holds on the page. */
const PART_CONTENT = {
  install: `<div><nav class="tabs-row" aria-label="MCP clients" data-clients>${clientLinks}</nav>${clientPanels}</div>`,
  'api-key': prose(API_KEY_BODY),
  access: `${accessParams}${prose(ACCESS_NOTES)}`,
  tools: `<div class="tool-groups">${TOOL_GROUPS_HTML}</div>`,
} satisfies Record<PartId, string>;

const BODY = `<div class="desk">
  <div class="book">
    ${COVER}
    ${PART_STRIP}
    <main class="leaves">${SHEET_HEAD}${PARTS.map((part) => sheet(part, PART_CONTENT[part.id])).join('')}
    </main>
    ${footer('page')}
  </div>
</div>`;

const PART_IDS = PARTS.map(({ id }) => id);

const CLIENT_ANCHORS = INSTALL_TABS.map(({ id }) => clientAnchor(id));

/** Which name the head row shows and which client procedure is open, by the attributes on <html>. */
const OPEN_CSS = [
  `html:not([data-part]) [data-head='${PART_IDS[0]}'], ${PART_IDS.map((id) => `html[data-part='${id}'] [data-head='${id}']`).join(', ')} { visibility: visible; }`,
  `${CLIENT_ANCHORS.map((id) => `html.js[data-client='${id}'] #${id}`).join(', ')} { display: block; }`,
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

const OPEN_AT_ADDRESS = openAtAddressScript(PART_IDS, CLIENT_ANCHORS);

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
