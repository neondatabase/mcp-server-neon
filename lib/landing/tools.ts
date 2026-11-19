import he from 'he';
import {
  DISCOVERY_LABEL,
  SCOPE_CATEGORY_LABELS,
} from '../../mcp/oauth/consent-dialog';
import { NEON_TOOLS } from '../../mcp/tools/definitions';
import type { NeonTool } from '../../mcp/tools/tool-definition';
import { SCOPE_CATEGORIES } from '../../mcp/utils/grant-context';

export const TOOL_COUNT = NEON_TOOLS.length;

type ToolGroup = {
  label: string;
  anchor: string;
  tools: readonly NeonTool[];
};

/** The address of a category's row in the tools part: `tools-neon-auth` for `neon_auth`. */
export const toolGroupAnchor = (scope: string | null): string =>
  `tools-${(scope ?? 'discovery').replaceAll('_', '-')}`;

export const TOOL_GROUPS: readonly ToolGroup[] = [
  null,
  ...SCOPE_CATEGORIES,
].flatMap((scope) => {
  const tools = NEON_TOOLS.filter((tool) => tool.scope === scope);

  const label = scope === null ? DISCOVERY_LABEL : SCOPE_CATEGORY_LABELS[scope];

  return tools.length === 0
    ? []
    : [{ label, anchor: toolGroupAnchor(scope), tools }];
});

const toolItem = (tool: NeonTool): string => {
  const { title } = tool.annotations;

  const titleHtml =
    title !== undefined && title !== tool.name
      ? `<span class="tool-title">${he.escape(title)}</span>`
      : '';

  const badge = tool.readOnlySafe ? '<span class="badge">read-only</span>' : '';

  return `<li class="tool"><div class="tool-name"><code>${he.escape(tool.name)}</code>${badge}${titleHtml}</div><p class="tool-desc">${he.escape(tool.description)}</p></li>`;
};

export const TOOL_GROUPS_HTML = TOOL_GROUPS.map(
  ({ label, anchor, tools }) =>
    `<details class="tool-group" id="${anchor}"><summary><span class="tool-group-label">${he.escape(label)}</span><span class="count">${tools.length}</span></summary><ul class="tool-list">${tools.map((tool) => toolItem(tool)).join('')}</ul></details>`,
).join('');
