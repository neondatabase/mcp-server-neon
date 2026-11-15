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
  tools: readonly NeonTool[];
};

export const TOOL_GROUPS: readonly ToolGroup[] = [
  null,
  ...SCOPE_CATEGORIES,
].flatMap((scope) => {
  const tools = NEON_TOOLS.filter((tool) => tool.scope === scope);

  const label = scope === null ? DISCOVERY_LABEL : SCOPE_CATEGORY_LABELS[scope];

  return tools.length === 0 ? [] : [{ label, tools }];
});

const toolItem = (tool: NeonTool): string => {
  const { title } = tool.annotations;

  const titleHtml =
    title !== undefined && title !== tool.name
      ? `<span>${he.escape(title)}</span>`
      : '';

  const badge = tool.readOnlySafe ? '<span class="badge">read-only</span>' : '';

  return `<div class="tool"><div class="tool-name"><code>${he.escape(tool.name)}</code>${titleHtml}${badge}</div><p class="tool-desc">${he.escape(tool.description)}</p></div>`;
};

export const TOOL_GROUPS_HTML = TOOL_GROUPS.map(
  ({ label, tools }) =>
    `<details class="tool-group"><summary><span>${he.escape(label)}</span><span class="count">${tools.length}</span></summary><div class="tool-list">${tools.map((tool) => toolItem(tool)).join('')}</div></details>`,
).join('');
