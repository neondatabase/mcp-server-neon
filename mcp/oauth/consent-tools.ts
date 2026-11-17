import {
  ALWAYS_AVAILABLE_TOOLS,
  PINNED_ROLE_WITHHELD_TOOLS,
} from '../tools/grant-filter';
import { NEON_TOOLS } from '../tools/definitions';
import type { GrantContext, ScopeCategory } from '../utils/grant-context';
import { withheldUnderSecrets } from '@neon/tools';
import { effectiveSecrets, SECRETS_CHOICES } from '../utils/secrets';
import type { SecretsChoice } from '../utils/secrets';

export type ConsentToolMeta = {
  name: string;
  title: string;
  scope: ScopeCategory | null;
  writeOnly: boolean;
  /** The secrets modes under which the tool refuses because its result is a secret. */
  withheldUnder: SecretsChoice[];
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
      withheldUnder: SECRETS_CHOICES.filter((mode) =>
        withheldUnderSecrets(tool, mode),
      ),
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
    if (
      grant.roleName !== undefined &&
      PINNED_ROLE_WITHHELD_TOOLS.has(tool.name)
    ) {
      return false;
    }

    if (tool.withheldUnder.includes(effectiveSecrets(grant, !writeChecked))) {
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
