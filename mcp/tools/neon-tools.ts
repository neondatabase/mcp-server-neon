import {
  createNeonTools,
  publishedId,
  type NeonToolDescriptionSource,
} from '@neon/tools';
import {
  NEON_API_HOST,
  NEON_DOCS_BASE_URL,
  NEON_FEEDBACK_URL,
  NEON_SITE_SEARCH_URL,
} from '../../lib/config';
import { fetchAsMcpServer } from '../neon-client';
import MCP_TOOL_NAMES from './mcp-tool-names.json';
import { isToolId, TOOL_IDS, type ToolId } from './operations';

/**
 * `mcp-tool-names.json` maps every name this server published before its tools
 * moved into `@neon/tools` to the selector that now implements it. It is a copy
 * of `packages/tools/scripts/mcp-tool-names.json` in neondatabase/neon-pkgs and
 * must stay identical to it.
 */
function pinnedNames(): Record<string, string> {
  const names: Record<string, string> = {};
  for (const [mcpName, id] of Object.entries(MCP_TOOL_NAMES)) {
    if (!isToolId(id)) {
      throw new Error(
        `mcp-tool-names.json maps ${mcpName} to unknown tool ${id}`,
      );
    }
    if (publishedId(id) !== mcpName) {
      names[id] = mcpName;
    }
  }
  return names;
}

const ORG_ID_AUTO_SELECTION =
  '`org_id` is optional: organization API keys use their organization; personal API keys auto-select when unambiguous and otherwise return the IDs to choose from.';

const MCP_DESCRIPTION_NOTES: Partial<Record<ToolId, string>> = {
  'projects.list': ORG_ID_AUTO_SELECTION,
  'projects.count': ORG_ID_AUTO_SELECTION,
  'projects.create': ORG_ID_AUTO_SELECTION,
  'postgres.connectionString':
    '`project_id` follows the connection scope. Requires write access: the connection string carries a privileged role password, so it is unavailable in read-only mode. A read-only caller who needs a DATABASE_URL must copy it from https://console.neon.tech manually.',
  'realtime.secret':
    'Requires write access: the secret lets its holder issue Realtime tokens for the branch, so it is unavailable in read-only mode.',
};

function withMcpNotes({ operationId, description }: NeonToolDescriptionSource) {
  const note = isToolId(operationId)
    ? MCP_DESCRIPTION_NOTES[operationId]
    : undefined;
  return note === undefined ? description : `${description} ${note}`;
}

export const NEON_PACKAGE_TOOLS = createNeonTools({
  tools: TOOL_IDS,
  baseUrl: NEON_API_HOST,
  fetch: fetchAsMcpServer,
  wait: { timeoutMs: 120_000 },
  names: pinnedNames(),
  descriptions: withMcpNotes,
  siteSearchUrl: NEON_SITE_SEARCH_URL,
  docsBaseUrl: NEON_DOCS_BASE_URL,
  feedbackUrl: NEON_FEEDBACK_URL,
  feedbackSource: 'neon_mcp',
});
