import { SCOPE_CATEGORIES } from '../../mcp/utils/grant-context';
import { getInstallTargets } from './install-targets';
import { API_KEY_URL, LIST_TOOLS_URL, MCP_URL } from './links';
import { TOOL_COUNT } from './tools';

type Section = {
  id: string;
  title: string;
  description: string;
};

type Block = Section & { body: string };

type InstallTab = {
  id: string;
  label: string;
  body: string;
  /** The body's paragraphs are steps to do in order, not alternatives. */
  sequence?: boolean;
};

const fence = (language: string, code: string): string =>
  `\`\`\`${language}\n${code}\n\`\`\``;

const install = getInstallTargets(MCP_URL);

const CURSOR_MANUAL =
  'Settings → MCP → Add server, then paste the MCP server URL.';

const VSCODE_MANUAL =
  'run **Chat: Open Customizations**, select **MCP Servers** → **Add Server**, choose **HTTP**, paste the MCP server URL, and enter `neon` as the server ID.';

const deeplink = (client: string, href: string, manual: string): string =>
  `[Open in ${client}](${href})\n\nOr add it manually: ${manual}`;

export const INSTALL_SECTION: Section = {
  id: 'install',
  title: 'Installation guide',
  description:
    'Choose your MCP client. It opens a browser window where you authorize access to your Neon account.',
};

export const INSTALL_TABS: readonly InstallTab[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    body: `Run this command in your terminal:\n\n${fence('bash', install.claudeCode)}\n\nThen start Claude Code, run \`/mcp\`, select \`neon\`, and authenticate.`,
    sequence: true,
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
};

export const ACCESS_PARAMS: readonly AccessParam[] = [
  { param: 'readonly=true', effect: 'publishes only read-only tools.' },
  {
    param: 'projectId=<id>',
    effect: 'limits the connection to one Neon project.',
  },
  {
    param: 'category=<name>',
    effect: `repeat to publish only those tool categories: ${SCOPE_CATEGORIES.map((category) => `\`${category}\``).join(', ')}.`,
  },
];

export const ACCESS_NOTES = [
  'Use only the documentation tools, with no account or sign-in:',
  fence('text', `${MCP_URL}?category=docs`),
  `Preview the tools a URL publishes at <${LIST_TOOLS_URL}> with the same query parameters.`,
].join('\n\n');

export const API_KEY_BLOCK: Block = {
  id: 'api-key',
  title: 'Connect with a Neon API key',
  description: 'For remote agents and clients without OAuth.',
  body: `[Create an API key](${API_KEY_URL}) in the Neon Console and send it as a bearer token:\n\n${fence('bash', install.addMcpWithApiKey)}`,
};

export const ACCESS_BLOCK: Block = {
  id: 'access',
  title: 'Limit access',
  description: 'Add query parameters to the MCP server URL.',
  body: [
    ACCESS_PARAMS.map(({ param, effect }) => `- \`${param}\`: ${effect}`).join(
      '\n',
    ),
    ACCESS_NOTES,
  ].join('\n\n'),
};

export const BLOCKS: readonly Block[] = [API_KEY_BLOCK, ACCESS_BLOCK];

export const TOOLS_SECTION: Section = {
  id: 'tools',
  title: `Tools (${TOOL_COUNT})`,
  description:
    'Every tool the server can publish, by category. Your grant decides which ones a connection sees.',
};
