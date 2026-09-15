import { ALWAYS_AVAILABLE_TOOLS } from '../tools/grant-filter';
import { NEON_TOOLS } from '../tools/definitions';
import type { GrantContext, ScopeCategory } from '../utils/grant-context';

export type ConsentToolMeta = {
  name: string;
  title: string;
  scope: ScopeCategory | null;
  writeOnly: boolean;
  projectScoped: boolean;
};

export function getConsentToolCatalog(): ConsentToolMeta[] {
  return NEON_TOOLS.map((tool) => {
    const title = tool.annotations.title;
    return {
      name: tool.name,
      title: typeof title === 'string' && title.length > 0 ? title : tool.name,
      scope: tool.scope,
      writeOnly: !tool.readOnlySafe,
      projectScoped: tool.projectScoped,
    };
  });
}

export function filterConsentCatalog(
  catalog: ConsentToolMeta[],
  grant: GrantContext,
  writeChecked: boolean,
): ConsentToolMeta[] {
  return catalog.filter((tool) => {
    if (!writeChecked && tool.writeOnly) {
      return false;
    }
    if (grant.projectId && !tool.projectScoped) {
      return false;
    }
    if (grant.scopes === null) {
      return true;
    }
    if (grant.scopes.length === 0) {
      return ALWAYS_AVAILABLE_TOOLS.has(tool.name);
    }
    if (ALWAYS_AVAILABLE_TOOLS.has(tool.name)) {
      return true;
    }
    if (!tool.scope) {
      return true;
    }
    return grant.scopes.includes(tool.scope);
  });
}
