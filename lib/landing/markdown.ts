import type { NeonTool } from '../../mcp/tools/tool-definition';
import { SERVER_INFO } from '../server-metadata';
import {
  BLOCKS,
  INSTALL_SECTION,
  INSTALL_TABS,
  TOOLS_SECTION,
} from './content';
import { DOCS_URL, MCP_URL, REPOSITORY_URL, STATUS_URL } from './links';
import { TOOL_GROUPS } from './tools';

type Heading = { title: string; description: string };

const section = ({ title, description }: Heading, body: string): string =>
  `## ${title}\n\n${description}\n\n${body}`;

const toolLine = (tool: NeonTool): string => {
  const flag = tool.readOnlySafe ? ' (read-only)' : '';

  return `- \`${tool.name}\`${flag}: ${tool.description.replaceAll(/\s+/gu, ' ').trim()}`;
};

const TOOLS_MARKDOWN = TOOL_GROUPS.map(
  ({ label, tools }) =>
    `### ${label} (${tools.length})\n\n${tools.map((tool) => toolLine(tool)).join('\n')}`,
).join('\n\n');

const LANDING_MARKDOWN = `${[
  `# Neon MCP Server\n\n> ${SERVER_INFO.description ?? ''}\n\nVersion ${SERVER_INFO.version}. MCP server URL: \`${MCP_URL}\``,
  section(
    INSTALL_SECTION,
    INSTALL_TABS.map(({ label, body }) => `### ${label}\n\n${body}`).join(
      '\n\n',
    ),
  ),
  ...BLOCKS.map((block) => section(block, block.body)),
  section(TOOLS_SECTION, TOOLS_MARKDOWN),
  `## Links\n\n- [Documentation](${DOCS_URL})\n- [GitHub](${REPOSITORY_URL})\n- [Status](${STATUS_URL})`,
].join('\n\n')}\n`;

export const renderLandingMarkdown = (): string => LANDING_MARKDOWN;
