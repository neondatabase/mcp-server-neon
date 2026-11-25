import { SCOPE_CATEGORIES } from '../../mcp/utils/grant-context';
import { SERVER_INFO } from '../server-metadata';
import { getInstallTargets } from './install-targets';
import { API_KEY_URL, LIST_TOOLS_URL, MCP_URL } from './links';
import { TOOL_COUNT } from './tools';

/** One part of the page, in its own words; the page and its Markdown copy each add the body. */
type Part = {
  id: string;
  /** The part's name in the single column's part strip. */
  nav: string;
  title: string;
  description: string;
};

type InstallTab = {
  id: string;
  label: string;
  body: string;
};

const fence = (language: string, code: string): string =>
  `\`\`\`${language}\n${code}\n\`\`\``;

/** Indents a block under the item of a numbered list, so it belongs to that step. */
const inStep = (block: string): string => block.replaceAll(/^/gmu, '   ');

const install = getInstallTargets(MCP_URL);

const CURSOR_MANUAL =
  'Settings → MCP → Add server, then paste the MCP server URL.';

const VSCODE_MANUAL =
  'run **Chat: Open Customizations**, select **MCP Servers** → **Add Server**, choose **HTTP**, paste the MCP server URL, and enter `neon` as the server ID.';

const deeplink = (client: string, href: string, manual: string): string =>
  `Add this server to ${client} in one click:\n\n[Open in ${client}](${href})\n\nOr add it manually: ${manual}`;

/** The cover's lead: the server's own description (server.json), then what an agent does with it. */
export const HERO_LEAD = [
  SERVER_INFO.description,
  'Create branches, run SQL, and tune queries from your AI agent.',
]
  .filter(Boolean)
  .join(' ');

export const INSTALL_PART = {
  id: 'install',
  nav: 'Install',
  title: 'Installation guide',
  description:
    'Choose your MCP client. It opens a browser window where you authorize access to your Neon account.',
} as const satisfies Part;

export const INSTALL_TABS: readonly InstallTab[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    body: [
      '1. Run this command in your terminal:',
      inStep(fence('bash', install.claudeCode)),
      '2. Then start Claude Code, run `/mcp`, select `neon`, and authenticate.',
    ].join('\n\n'),
  },
  {
    id: 'cursor',
    label: 'Cursor',
    body: deeplink('Cursor', install.cursor, CURSOR_MANUAL),
  },
  {
    id: 'vscode',
    label: 'VS Code',
    body: deeplink('VS Code', install.vscode, VSCODE_MANUAL),
  },
  {
    id: 'vscode-insiders',
    label: 'VS Code Insiders',
    body: deeplink('VS Code Insiders', install.vscodeInsiders, VSCODE_MANUAL),
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    body: install.chatgptSteps
      .map(
        ([heading, instruction], index) =>
          `${index + 1}. **${heading}:** ${instruction}`,
      )
      .join('\n'),
  },
  {
    id: 'other',
    label: 'Other clients',
    body: [
      'Add the server to every agent and editor detected in your workspace:',
      fence('bash', install.addMcp),
      "Or add this entry to your client's MCP configuration:",
      fence('json', install.config),
      'Clients that only support stdio can bridge the endpoint:',
      fence('bash', install.mcpRemote),
    ].join('\n\n'),
  },
];

type AccessParam = {
  param: string;
  effect: string;
  /** The values the parameter takes, listed after the effect; most take any value. */
  values: readonly string[];
};

export const ACCESS_PARAMS: readonly AccessParam[] = [
  {
    param: 'readonly=true',
    effect: 'Publishes only read-only tools.',
    values: [],
  },
  {
    param: 'projectId=<id>',
    effect: 'Limits the connection to one Neon project.',
    values: [],
  },
  {
    param: 'category=<name>',
    effect: 'Repeat to publish only those tool categories',
    values: SCOPE_CATEGORIES,
  },
];

/** A parameter's effect as one sentence, its values (each set by `value`) after a colon. */
export const paramEffect = (
  { effect, values }: AccessParam,
  value: (name: string) => string,
): string =>
  values.length === 0
    ? effect
    : `${effect}: ${values.map((name) => value(name)).join(', ')}.`;

export const ACCESS_NOTES = [
  'Use only the documentation tools, with no account or sign-in:',
  fence('text', `${MCP_URL}?category=docs`),
  `Preview the tools a URL publishes at <${LIST_TOOLS_URL}> with the same query parameters.`,
].join('\n\n');

const API_KEY_PART = {
  id: 'api-key',
  nav: 'API key',
  title: 'Connect with a Neon API key',
  description: 'For remote agents and clients without OAuth.',
} as const satisfies Part;

export const API_KEY_BODY = `[Create an API key](${API_KEY_URL}) in the Neon Console and send it as a bearer token:\n\n${fence('bash', install.addMcpWithApiKey)}`;

const ACCESS_PART = {
  id: 'access',
  nav: 'Limit access',
  title: 'Limit access',
  description: 'Add query parameters to the MCP server URL.',
} as const satisfies Part;

const TOOLS_PART = {
  id: 'tools',
  nav: 'Tools',
  title: `Tools (${TOOL_COUNT})`,
  description:
    'Every tool the server can publish, by category. Your grant decides which ones a connection sees.',
} as const satisfies Part;

/** The parts in page order. */
export const PARTS = [INSTALL_PART, API_KEY_PART, ACCESS_PART, TOOLS_PART];

export type PartId = (typeof PARTS)[number]['id'];
