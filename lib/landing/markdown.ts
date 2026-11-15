import type { NeonTool } from '../../mcp/tools/tool-definition';
import { SCOPE_CATEGORIES } from '../../mcp/utils/grant-context';
import { SERVER_INFO } from '../server-metadata';
import { getInstallTargets } from './install-targets';
import type { InstallTargets } from './install-targets';
import {
  API_KEY_URL,
  DOCS_URL,
  LIST_TOOLS_URL,
  MCP_URL,
  REPOSITORY_URL,
  STATUS_URL,
} from './links';
import { TOOL_COUNT, TOOL_GROUPS } from './tools';

const fence = (language: string, code: string): string =>
  `\`\`\`${language}\n${code}\n\`\`\``;

const installSection = (
  install: InstallTargets,
): string => `## Installation guide

Choose your MCP client. It opens a browser window where you authorize access to your Neon account.

### Claude Code

${fence('bash', install.claudeCode)}

### Cursor

[Add to Cursor](${install.cursor}), or open Settings → MCP → Add server and paste \`${MCP_URL}\`.

### VS Code

[Install in VS Code](${install.vscode}) or [VS Code Insiders](${install.vscodeInsiders}).

### ChatGPT

${install.chatgptSteps.map(([heading, instruction], index) => `${index + 1}. **${heading}:** ${instruction}`).join('\n')}

### Other clients

Add the server to every agent and editor detected in your workspace:

${fence('bash', install.addMcp)}

Or add this entry to your client's MCP configuration:

${fence('json', install.config)}

Clients that only support stdio can bridge the endpoint:

${fence('bash', install.mcpRemote)}`;

const apiKeySection = (
  install: InstallTargets,
): string => `## Connect with a Neon API key

For remote agents and clients without OAuth. [Create an API key](${API_KEY_URL}) in the Neon Console and send it as a bearer token:

${fence('bash', install.addMcpWithApiKey)}`;

const accessSection = (): string => `## Limit access

Add query parameters to the MCP server URL:

- \`readonly=true\`: publishes only read-only tools.
- \`projectId=<id>\`: limits the connection to one Neon project.
- \`category=<name>\`: repeat to publish only those tool categories: ${SCOPE_CATEGORIES.map((category) => `\`${category}\``).join(', ')}.

Use only the documentation tools, with no account or sign-in:

${fence('text', `${MCP_URL}?category=docs`)}

Preview the tools a URL publishes at ${LIST_TOOLS_URL} with the same query parameters.`;

const toolLine = (tool: NeonTool): string => {
  const flag = tool.readOnlySafe ? ' (read-only)' : '';

  return `- \`${tool.name}\`${flag}: ${tool.description.replaceAll(/\s+/gu, ' ').trim()}`;
};

const toolsSection = (): string => `## Tools (${TOOL_COUNT})

Every tool the server can publish, by category. Your grant decides which ones a connection sees.

${TOOL_GROUPS.map(({ label, tools }) => `### ${label} (${tools.length})\n\n${tools.map((tool) => toolLine(tool)).join('\n')}`).join('\n\n')}`;

export const renderLandingMarkdown = (): string => {
  const install = getInstallTargets(MCP_URL);

  return `# Neon MCP Server

> ${SERVER_INFO.description ?? ''}

Version ${SERVER_INFO.version}. MCP server URL: \`${MCP_URL}\`

${installSection(install)}

${apiKeySection(install)}

${accessSection()}

${toolsSection()}

## Links

- [Documentation](${DOCS_URL})
- [GitHub](${REPOSITORY_URL})
- [Status](${STATUS_URL})
`;
};
