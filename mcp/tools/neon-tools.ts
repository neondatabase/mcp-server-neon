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

const OAUTH_PROVIDER_DESCRIPTIONS: Partial<Record<ToolId, string>> = {
  'auth.oauthProviders.list':
    "Lists the social login providers (Google, GitHub, Microsoft, Vercel, Apple, Discord) of a branch's Neon Auth. For Neon Auth as an OAuth server, use get_auth_oauth_server.",
  'auth.oauthProviders.add':
    "Adds a social login provider (Google, GitHub, Microsoft, Vercel, Apple, Discord) to a branch's Neon Auth. Microsoft, Apple, and Discord have no shared app, so they need your own `client_id` and `client_secret`. Apple and Discord work only on Better Auth projects, not legacy Stack Auth. For Apple, `client_id` is the Services ID, `client_secret` is the `.p8` private key, and `apple_team_id` and `apple_key_id` are required. For Neon Auth as an OAuth server, use update_auth_oauth_server.",
  'auth.oauthProviders.update':
    "Updates a social login provider (Google, GitHub, Microsoft, Vercel, Apple, Discord) on a branch's Neon Auth. For Apple, a new `client_secret` (`.p8` key) must be sent with its `apple_key_id`. For Neon Auth as an OAuth server, use update_auth_oauth_server.",
  'auth.oauthProviders.delete':
    "Deletes a social login provider (Google, GitHub, Microsoft, Vercel, Apple, Discord) from a branch's Neon Auth. For Neon Auth as an OAuth server, use update_auth_oauth_server.",
};

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
  const override = isToolId(operationId)
    ? OAUTH_PROVIDER_DESCRIPTIONS[operationId]
    : undefined;

  if (override !== undefined) {
    return override;
  }

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
