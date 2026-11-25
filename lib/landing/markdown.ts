import type { NeonTool } from '../../mcp/tools/tool-definition';
import { SERVER_INFO } from '../server-metadata';
import {
  ACCESS_NOTES,
  ACCESS_PARAMS,
  API_KEY_BODY,
  HERO_LEAD,
  INSTALL_TABS,
  PARTS,
  paramEffect,
} from './content';
import type { PartId } from './content';
import { DOCS_URL, MCP_URL, REPOSITORY_URL, STATUS_URL } from './links';
import { TOOL_GROUPS } from './tools';

const section = (
  { title, description }: (typeof PARTS)[number],
  body: string,
): string => `## ${title}\n\n${description}\n\n${body}`;

const toolLine = (tool: NeonTool): string => {
  const flag = tool.readOnlySafe ? ' (read-only)' : '';

  return `- \`${tool.name}\`${flag}: ${tool.description.replaceAll(/\s+/gu, ' ').trim()}`;
};

const TOOLS_MARKDOWN = TOOL_GROUPS.map(
  ({ label, tools }) =>
    `### ${label} (${tools.length})\n\n${tools.map((tool) => toolLine(tool)).join('\n')}`,
).join('\n\n');

const ACCESS_MARKDOWN = [
  ACCESS_PARAMS.map(
    (param) =>
      `- \`${param.param}\`: ${paramEffect(param, (value) => `\`${value}\``)}`,
  ).join('\n'),
  ACCESS_NOTES,
].join('\n\n');

/** What each part holds in the Markdown copy. */
const PART_MARKDOWN = {
  install: INSTALL_TABS.map(
    ({ label, body }) => `### ${label}\n\n${body}`,
  ).join('\n\n'),
  'api-key': API_KEY_BODY,
  access: ACCESS_MARKDOWN,
  tools: TOOLS_MARKDOWN,
} satisfies Record<PartId, string>;

const LANDING_MARKDOWN = `${[
  `# Neon MCP Server\n\n> ${HERO_LEAD}\n\nVersion ${SERVER_INFO.version}. MCP server URL: \`${MCP_URL}\``,
  ...PARTS.map((part) => section(part, PART_MARKDOWN[part.id])),
  `## Links\n\n- [Documentation](${DOCS_URL})\n- [GitHub](${REPOSITORY_URL})\n- [Status](${STATUS_URL})`,
].join('\n\n')}\n`;

export const renderLandingMarkdown = (): string => LANDING_MARKDOWN;
