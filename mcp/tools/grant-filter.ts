import { z } from 'zod/v3';
import { z as z4 } from 'zod';
import { InvalidArgumentError } from '../server/errors';
import {
  SCOPE_CATEGORIES,
  type GrantContext,
  type ScopeCategory,
} from '../utils/grant-context';
import { NEON_TOOLS } from './definitions';
import type { NeonTool } from './tool-definition';

/**
 * Tools that are always available regardless of scope categories.
 * These are discovery/navigation tools the LLM needs to function, plus
 * send_feedback so users can always reach the Neon team.
 */
export const ALWAYS_AVAILABLE_TOOLS: ReadonlySet<string> = new Set([
  'search',
  'fetch',
  'send_feedback',
]);

/**
 * Tools served by the no-login `?category=docs` endpoint. None of them use
 * the Neon API client, so they are safe to call anonymously.
 */
export function isDocsOnlyTool(tool: Pick<NeonTool, 'name' | 'scope'>) {
  return tool.scope === 'docs' || tool.name === 'send_feedback';
}

// Hosts may cache this schema and its instructions independently of the grant.
const PROJECT_ID_GUIDANCE =
  'Required for an unscoped connection. May be omitted when the connection is ' +
  'scoped to one project; if provided, it must match that project.';

function withProjectIdGuidance(description: string | undefined): string {
  const base = description?.trim();
  if (!base) return PROJECT_ID_GUIDANCE;
  return `${/[.!?]$/.test(base) ? base : `${base}.`} ${PROJECT_ID_GUIDANCE}`;
}

function isZod4Object(schema: unknown): schema is z4.ZodObject<z4.ZodRawShape> {
  return (
    typeof schema === 'object' &&
    schema !== null &&
    '_zod' in schema &&
    'shape' in schema
  );
}

export function filterToolsForGrant(
  tools: readonly NeonTool[],
  grant: GrantContext,
): NeonTool[] {
  let filtered = applyScopeCategoryFilter(tools, grant.scopes);
  filtered = applyProjectScopeFilter(filtered, grant);
  // Hosts can review and cache one schema independently of a user's grant.
  // Keep project_id optional on the wire; the full handler schema still
  // requires it after a scoped grant has supplied its project.
  return filtered.map((tool) => optionalProjectIdSchema(tool) ?? tool);
}

/**
 * Filter tools by scope categories.
 */
function applyScopeCategoryFilter(
  tools: readonly NeonTool[],
  scopes: ScopeCategory[] | null,
): NeonTool[] {
  if (scopes === null) {
    return [...tools];
  }
  if (scopes.length === 0) {
    return tools.filter((tool) => ALWAYS_AVAILABLE_TOOLS.has(tool.name));
  }

  const scopeSet = new Set(scopes);

  return tools.filter((tool) => {
    if (ALWAYS_AVAILABLE_TOOLS.has(tool.name)) return true;
    if (!tool.scope) return true;
    return scopeSet.has(tool.scope);
  });
}

function applyProjectScopeFilter(
  tools: NeonTool[],
  grant: GrantContext,
): NeonTool[] {
  if (!grant.projectId) return tools;

  return tools.filter((tool) => tool.projectScoped);
}

function optionalHostProjectId(tool: NeonTool): NeonTool | null {
  const schema = tool.inputSchema;
  if (!(schema instanceof z.ZodObject)) return null;

  const shape = schema.shape as Record<string, z.ZodTypeAny>;
  if (!('project_id' in shape)) return null;

  return {
    ...tool,
    inputSchema: schema
      .extend({
        project_id: shape.project_id
          .optional()
          .describe(withProjectIdGuidance(shape.project_id.description)),
      })
      .strict(),
  };
}

function optionalGeneratedProjectId(tool: NeonTool): NeonTool | null {
  const schema = tool.inputSchema;
  if (!isZod4Object(schema)) return null;
  if (!('project_id' in schema.shape)) return null;
  const projectIdSchema = schema.shape.project_id;

  return {
    ...tool,
    inputSchema: z4.strictObject({
      ...schema.shape,
      project_id: z4
        .optional(projectIdSchema)
        .describe(
          withProjectIdGuidance(
            z4.globalRegistry.get(projectIdSchema)?.description,
          ),
        ),
    }),
  };
}

function optionalProjectIdSchema(tool: NeonTool): NeonTool | null {
  if (!tool.projectScoped) return null;
  if (tool.kind === 'generated') {
    return optionalGeneratedProjectId(tool);
  }
  return optionalHostProjectId(tool);
}

/**
 * Returned separately so each server-level notice is sent once instead of
 * being duplicated across every tool description.
 */
export function getAccessControlNotices(
  grant: GrantContext,
  readOnly: boolean,
): string[] {
  const notices: string[] = [];
  if (readOnly) {
    notices.push(
      'Notice: The MCP server is currently configured with read-only permissions. ' +
        'All write-access tools have been removed. Neon resources stay read-only: the remaining tools only read them ' +
        '(for example, read-only SQL queries). The user can still send feedback to Neon with send_feedback. ' +
        'Do not try to work around this restriction; it is intentional. ' +
        'If the user requests changes to Neon resources, inform them about the read-only configuration. ' +
        'Connection strings are unavailable in this mode because they carry a privileged role password; ' +
        'if the user needs a DATABASE_URL, tell them to copy it from https://console.neon.tech. ' +
        'The user can remove read-only mode by removing the readonly query param from the MCP server URL, ' +
        'then authorizing again when using OAuth.',
    );
  } else {
    const hasExposedDestructive = getFilteredTools(grant, false).some(
      (tool) => tool.annotations?.destructiveHint === true,
    );
    if (hasExposedDestructive) {
      notices.push(
        'Notice: Write mode active. Destructive tools are exposed. ' +
          'For tools with `destructiveHint: true`, NEVER invoke autonomously; always ask the user first.',
      );
    }
  }
  const hasProjectTools = getFilteredTools(grant, readOnly).some(
    (tool) => tool.projectScoped && schemaHasProjectId(tool.inputSchema),
  );
  if (hasProjectTools) {
    notices.push(
      'Notice: For tools with `project_id`, always pass it on an unscoped connection, even though the published schema marks it optional. ' +
        'A connection scoped to one project supplies it automatically when omitted; an explicit value must match the granted project. ' +
        'A project-scoped connection also hides project management tools such as list_projects and create_project. ' +
        'To change project scope, change or remove the projectId query param in the MCP server URL and reconnect. ' +
        'With OAuth, the project is fixed when the connection is authorized: log out and authorize again, ' +
        'and choose "All projects you can access" on the consent page to remove scoping.',
    );
  }
  if (grant.unknownCategories?.length) {
    notices.push(
      'Notice: Unknown category query values were ignored: ' +
        `${grant.unknownCategories.join(', ')}. ` +
        `Valid values: ${SCOPE_CATEGORIES.join(', ')}.`,
    );
  }
  return notices;
}

/**
 * Return the filtered tool set for a given grant + read-only combination,
 * WITHOUT the access-control notice suffix in tool descriptions. This is the
 * shape `/api/list-tools` consumes — notices are surfaced as a top-level
 * field instead.
 *
 * Combines two filtering stages:
 * 1. Grant-based filtering (scope categories + project scoping)
 * 2. Read-only filtering (strips non-readOnlySafe tools when read-only is active)
 */
export function getFilteredTools(
  grant: GrantContext,
  readOnly: boolean,
): NeonTool[] {
  let tools = filterToolsForGrant(NEON_TOOLS, grant);
  if (readOnly) {
    tools = tools.filter((tool) => tool.readOnlySafe);
  }
  return tools;
}

export function getAvailableTools(
  grant: GrantContext,
  readOnly: boolean,
): NeonTool[] {
  return getFilteredTools(grant, readOnly);
}

export function formatAccessControlInstructions(
  grant: GrantContext,
  readOnly: boolean,
): string | undefined {
  const parts = [
    ...getAccessControlNotices(grant, readOnly),
    ...getAccessControlWarnings(grant, readOnly),
  ];
  if (parts.length === 0) return undefined;
  return parts.join('\n\n');
}

/**
 * Build warning messages for access control edge cases.
 *
 * Returns human-readable warnings (using ⚠️ prefix) that should be
 * appended to tool call responses so the LLM is aware of
 * contradictory or potentially confusing configurations.
 */
export function getAccessControlWarnings(
  grant: GrantContext,
  _readOnly: boolean,
): string[] {
  void _readOnly;
  const warnings: string[] = [];

  if (grant.scopes !== null && grant.scopes.length === 0) {
    const discoveryToolsText = grant.projectId
      ? 'Only the "send_feedback" tool is available.'
      : 'Only the "search", "fetch", and "send_feedback" tools are available.';
    warnings.push(
      '⚠️ Warning: No valid scope categories are set. ' +
        `${discoveryToolsText} ` +
        'Add scope categories via the category query param (e.g., "?category=querying&category=schema") ' +
        'to enable additional tools.',
    );
  }

  return warnings;
}

function schemaHasProjectId(schema: NeonTool['inputSchema']): boolean {
  if (schema instanceof z.ZodObject) {
    return 'project_id' in schema.shape;
  }
  if (isZod4Object(schema)) {
    return 'project_id' in schema.shape;
  }
  return false;
}

export function injectProjectId(
  args: Record<string, unknown>,
  grant: GrantContext,
  tool?: Pick<NeonTool, 'kind' | 'projectScoped'> & {
    inputSchema?: NeonTool['inputSchema'];
  },
): Record<string, unknown> {
  if (tool && !tool.projectScoped) return args;
  if (tool?.inputSchema && !schemaHasProjectId(tool.inputSchema)) {
    return args;
  }
  if (!grant.projectId) {
    if (args.project_id === undefined && tool?.inputSchema) {
      throw new InvalidArgumentError(
        'project_id is required because this connection is not scoped to a project. ' +
          'Pass the target project ID, for example one returned by list_projects.',
      );
    }
    return args;
  }
  if (args.project_id !== undefined && args.project_id !== grant.projectId) {
    throw new InvalidArgumentError(
      `project_id "${String(args.project_id)}" does not match this connection's project "${grant.projectId}". ` +
        'Omit project_id to use that project. To work on another project, reconnect with access to it.',
    );
  }
  return { ...args, project_id: grant.projectId };
}
