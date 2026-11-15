import he from 'he';
import { SCOPE_CATEGORIES } from '../../mcp/utils/grant-context';
import { SERVER_INFO } from '../server-metadata';
import { HERO_VIDEO_HTML, HERO_VIDEO_SCRIPT } from './hero-video';
import { getInstallTargets } from './install-targets';
import type { InstallTargets } from './install-targets';
import { COPY_ICON, INTERACTION_SCRIPT } from './interactions';
import {
  API_KEY_URL,
  DOCS_URL,
  LIST_TOOLS_URL,
  MARKDOWN_PATH,
  MCP_URL,
  OG_IMAGE_URL,
  REPOSITORY_URL,
  STATUS_URL,
} from './links';
import { LANDING_PAGE_CSS } from './styles';
import { TOOL_COUNT, TOOL_GROUPS_HTML } from './tools';

const FONT_LINKS = `<link rel="preload" href="/fonts/inter/inter-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/geist-mono/GeistMono-Variable.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/fonts/inter/inter.css">
<link rel="stylesheet" href="/fonts/geist-mono/geist-mono.css">`;

const LINE_INTERSECTION_PATH =
  'M10.5 4C10.5 7.31371 7.81371 10 4.5 10H0.5V11H4.5C7.81371 11 10.5 13.6863 10.5 17V21H11.5V17C11.5 13.6863 14.1863 11 17.5 11H21.5V10H17.5C14.1863 10 11.5 7.31371 11.5 4V0H10.5V4Z';

const external = (href: string): string =>
  `href="${he.escape(href)}" target="_blank" rel="noopener noreferrer"`;

const copyButton = (text: string, label = 'Copy'): string =>
  `<button type="button" class="copy-btn" data-copy="${he.escape(text)}" aria-label="${label}">${COPY_ICON}</button>`;

const keepFlagsWhole = (html: string): string =>
  html.replaceAll(
    /(?<lead>^|\s)(?<flag>-[^\s]+)/gu,
    '$<lead><span class="nowrap">$<flag></span>',
  );

const codeBlock = (code: string): string =>
  `<div class="code-block"><pre><code>${keepFlagsWhole(he.escape(code))}</code></pre>${copyButton(code)}</div>`;

const corner = (position: string): string =>
  `<svg class="corner corner-${position}" viewBox="0 0 22 21" fill="none" aria-hidden="true"><path d="${LINE_INTERSECTION_PATH}" fill="currentColor"/></svg>`;

const frame = (): string =>
  `<div class="rail rail-left"></div><div class="rail rail-right"></div><div class="rail rail-top"></div><div class="rail rail-bottom"></div>
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

const heroSection = (url: string): string => `
  <header class="card hero-card">
    <div class="hero-media">
      ${HERO_VIDEO_HTML}
      <div class="hero-inner hero">
        <a class="hero-logo" ${external('https://neon.com')}><img src="/images/landing/neon-logo.svg" alt="Neon" width="117" height="32"></a>
        <h1 id="hero-title">Neon MCP Server <span class="version">v${he.escape(SERVER_INFO.version)}</span></h1>
        <p class="hero-description">${he.escape(SERVER_INFO.description ?? '')}</p>
        <div class="url-pill"><code>${he.escape(url)}</code>${copyButton(url, 'Copy MCP server URL')}</div>
        <div class="cta-row">
          <a class="btn btn-primary" ${external(DOCS_URL)}>Read the docs</a>
        </div>
      </div>
    </div>
  </header>`;

const TABS = [
  ['claude-code', 'Claude Code'],
  ['cursor', 'Cursor'],
  ['vscode', 'VS Code'],
  ['vscode-insiders', 'VS Code Insiders'],
  ['chatgpt', 'ChatGPT'],
  ['other', 'Other clients'],
] as const;

const deeplinkPanel = (client: string, deeplink: string): string => `
        <h3>Install in ${client}</h3>
        <p>Click the button below to add the Neon MCP server to ${client}:</p>
        <a class="btn btn-primary install-btn" href="${he.escape(deeplink)}">Open in ${client}</a>
        <p>Or add it manually: Settings → MCP → Add server, then paste the URL above.</p>`;

const tabPanels = (install: InstallTargets) =>
  ({
    'claude-code': `
        <h3>Install in Claude Code</h3>
        <p>Run this command in your terminal:</p>
        ${codeBlock(install.claudeCode)}`,
    cursor: deeplinkPanel('Cursor', install.cursor),
    vscode: deeplinkPanel('VS Code', install.vscode),
    'vscode-insiders': deeplinkPanel(
      'VS Code Insiders',
      install.vscodeInsiders,
    ),
    chatgpt: `
        <h3>Connect with ChatGPT</h3>
        <ol class="steps">${install.chatgptSteps
          .map(
            ([heading, instruction]) =>
              `<li><strong>${he.escape(heading)}:</strong> ${he.escape(instruction)}</li>`,
          )
          .join('')}</ol>`,
    other: `
        <h3>Any MCP client</h3>
        <p>Add the server to every agent and editor detected in your workspace:</p>
        ${codeBlock(install.addMcp)}
        <p>Or add this entry to your client's MCP configuration:</p>
        ${codeBlock(install.config)}
        <p>Clients that only support stdio can bridge the endpoint:</p>
        ${codeBlock(install.mcpRemote)}`,
  }) satisfies Record<(typeof TABS)[number][0], string>;

const installSection = (install: InstallTargets): string => {
  const panels = tabPanels(install);

  const tabs = TABS.map(
    ([id, label], index) =>
      `<button type="button" class="tab" role="tab" id="tab-${id}" aria-controls="panel-${id}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}">${label}</button>`,
  ).join('');

  const panelHtml = TABS.map(
    ([id], index) =>
      `<div class="tab-panel" role="tabpanel" id="panel-${id}" aria-labelledby="tab-${id}"${index === 0 ? '' : ' hidden'}>${panels[id]}</div>`,
  ).join('');

  return card(
    {
      id: 'install',
      title: 'Installation guide',
      description:
        'Choose your MCP client. It opens a browser window where you authorize access to your Neon account.',
    },
    `<div class="tabs-row" role="tablist" aria-label="MCP clients">${tabs}</div>${panelHtml}`,
  );
};

const apiKeySection = (install: InstallTargets): string =>
  card(
    {
      id: 'api-key',
      title: 'Connect with a Neon API key',
      description: 'For remote agents and clients without OAuth.',
    },
    `<p><a ${external(API_KEY_URL)}>Create an API key</a> in the Neon Console and send it as a bearer token:</p>
      ${codeBlock(install.addMcpWithApiKey)}`,
  );

const accessSection = (url: string): string => {
  const categories = SCOPE_CATEGORIES.map(
    (category) => `<code class="chip">${category}</code>`,
  ).join('');

  return card(
    {
      id: 'access',
      title: 'Limit access',
      description: 'Add query parameters to the MCP server URL.',
    },
    `<ul class="params">
        <li><code>readonly=true</code><span>Publishes only read-only tools.</span></li>
        <li><code>projectId=&lt;id&gt;</code><span>Limits the connection to one Neon project.</span></li>
        <li><code>category=&lt;name&gt;</code><span>Repeat to publish only those tool categories:<span class="chips">${categories}</span></span></li>
      </ul>
      <p>Use only the documentation tools, with no account or sign-in:</p>
      ${codeBlock(`${url}?category=docs`)}
      <p>Preview the tools a URL publishes at <a href="${he.escape(LIST_TOOLS_URL)}">${he.escape(LIST_TOOLS_URL)}</a> with the same query parameters.</p>`,
  );
};

const toolsSection = (): string =>
  card(
    {
      id: 'tools',
      title: `Tools (${TOOL_COUNT})`,
      description:
        'Every tool the server can publish, by category. Your grant decides which ones a connection sees.',
    },
    TOOL_GROUPS_HTML,
  );

const footer = (): string => `
  <footer class="footer">
    <a class="footer-brand" ${external('https://neon.com')}><img src="/images/landing/neon-logo.svg" alt="Neon" width="88" height="24"></a>
    <nav class="footer-links" aria-label="Resources">
      <a ${external(DOCS_URL)}>Docs</a>
      <a ${external(REPOSITORY_URL)}>GitHub</a>
      <a ${external(STATUS_URL)}>Status</a>
    </nav>
  </footer>`;

const head = (nonce: string): string => {
  const title = 'Neon MCP Server — Connect with Claude Code, Cursor & VS Code';
  const description = he.escape(SERVER_INFO.description ?? title);

  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#000000">
<title>${title}</title>
<meta name="description" content="${description}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
<meta property="og:image" content="${OG_IMAGE_URL}">
<link rel="alternate" type="text/markdown" href="${MARKDOWN_PATH}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
${FONT_LINKS}
<style nonce="${nonce}">${LANDING_PAGE_CSS}</style>`;
};

export const renderLandingPage = (nonce: string): string => {
  const install = getInstallTargets(MCP_URL);

  return `<!DOCTYPE html>
<html lang="en">
<head>
${head(nonce)}
</head>
<body>
<div class="layout">
  ${frame()}
  ${heroSection(MCP_URL)}
  ${installSection(install)}
  ${apiKeySection(install)}
  ${accessSection(MCP_URL)}
  ${toolsSection()}
  ${footer()}
</div>
<script nonce="${nonce}">${HERO_VIDEO_SCRIPT}</script>
<script nonce="${nonce}">${INTERACTION_SCRIPT}</script>
</body>
</html>`;
};
