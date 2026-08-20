/**
 * Tool filtering based on grant context.
 *
 * Handles:
 * - Scope-category-based filtering
 * - Project-scoped mode: hiding project-agnostic tools and removing projectId
 *   from host schemas / path.project_id from generated schemas
 */

import { z } from 'zod/v3';
import { z as z4 } from 'zod';
import type { GrantContext, ScopeCategory } from '../utils/grant-context';
import { NEON_TOOLS } from './definitions';
import type { NeonTool } from './tool-definition';

/**
 * Tools that are always available regardless of scope categories.
 * These are discovery/navigation tools the LLM needs to function.
 */
const ALWAYS_AVAILABLE_TOOLS: ReadonlySet<string> = new Set([
  'search',
  'fetch',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isZod4Object(schema: unknown): schema is z4.ZodObject<z4.ZodRawShape> {
  return (
    typeof schema === 'object' &&
    schema !== null &&
    '_zod' in schema &&
    'shape' in schema
  );
}

/**
 * Filter tools based on the grant context.
 *
 * Returns a new array of tools with:
 * 1. Scope-category filtering applied
 * 2. Project-agnostic tools removed (if project-scoped)
 * 3. projectId / path.project_id removed from schemas (if project-scoped)
 */
export function filterToolsForGrant(
  tools: readonly NeonTool[],
  grant: GrantContext,
): NeonTool[] {
  let filtered = applyScopeCategoryFilter(tools, grant.scopes);
  filtered = applyProjectScopeFilter(filtered, grant);
  return filtered;
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

/**
 * Apply project-scoped filtering.
 * When a projectId is set, hide tools that are not project-scoped and
 * strip the project identifier from published schemas.
 */
function applyProjectScopeFilter(
  tools: NeonTool[],
  grant: GrantContext,
): NeonTool[] {
  if (!grant.projectId) return tools;

  return tools
    .filter((tool) => tool.projectScoped)
    .map((tool) => {
      const modified = removeProjectIdFromSchema(tool);
      return modified ?? tool;
    });
}

function removeHostProjectId(tool: NeonTool): NeonTool | null {
  const schema = tool.inputSchema;
  if (!(schema instanceof z.ZodObject)) return null;

  const shape = schema.shape as Record<string, z.ZodTypeAny>;
  if (!('projectId' in shape)) return null;

  const newShape: Record<string, z.ZodTypeAny> = {};
  for (const [key, value] of Object.entries(shape)) {
    if (key !== 'projectId') {
      newShape[key] = value;
    }
  }

  return {
    ...tool,
    inputSchema: z.object(newShape),
  };
}

function removeGeneratedProjectId(tool: NeonTool): NeonTool | null {
  const schema = tool.inputSchema;
  if (!isZod4Object(schema)) return null;

  const pathSchema = schema.shape.path;
  if (!isZod4Object(pathSchema)) return null;
  if (!('project_id' in pathSchema.shape)) return null;

  const restPath = Object.fromEntries(
    Object.entries(pathSchema.shape).filter(([key]) => key !== 'project_id'),
  );
  const newShape = Object.fromEntries(
    Object.entries(schema.shape).flatMap(([key, value]) => {
      if (key !== 'path') {
        return [[key, value]];
      }
      if (Object.keys(restPath).length === 0) {
        return [];
      }
      return [['path', z4.object(restPath)]];
    }),
  );

  return {
    ...tool,
    inputSchema: z4.object(newShape),
  };
}

/**
 * Remove the project identifier from a tool's published input schema.
 * Host tools use root `projectId`; generated tools use `path.project_id`.
 */
function removeProjectIdFromSchema(tool: NeonTool): NeonTool | null {
  if (tool.kind === 'generated') {
    return removeGeneratedProjectId(tool);
  }
  return removeHostProjectId(tool);
}

/**
 * Build the access-control notices for the given grant + read-only combination.
 * Each notice covers one active condition: read-only (restriction), write mode
 * with destructive tools exposed (safety), project-scoped (scope). Empty array
 * when none apply.
 *
 * Exposed separately from `getAvailableTools` so the `/api/list-tools` REST
 * endpoint can surface notices as a top-level field instead of duplicating
 * the same block inside every tool's `description` (see
 * github.com/neondatabase/mcp-server-neon/issues/257). The MCP-protocol tool
 * registration path keeps the notice inline by going through
 * `getAvailableTools`, which still concatenates these into descriptions for
 * LLM consumption.
 */
export function getAccessControlNotices(
  grant: GrantContext,
  readOnly: boolean,
): string[] {
  const notices: string[] = [];
  if (readOnly) {
    notices.push(
      'Notice: The MCP server is currently configured with read-only permissions. ' +
        'All write-access tools have been removed. All remaining tools are limited to read-only operations ' +
        '(for example, read-only SQL queries). Do not try to work around this restriction; it is intentional. ' +
        'If the user requests changes to Neon resources, inform them about the read-only configuration. ' +
        'Connection strings are unavailable in this mode because they carry a privileged role password; ' +
        'if the user needs a DATABASE_URL, tell them to copy it from https://console.neon.tech. ' +
        'The user can remove read-only mode by removing the readonly query param from the MCP server URL, ' +
        'or by logging out and back in with OAuth and selecting full access.',
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
  if (grant.projectId) {
    notices.push(
      `Notice: The MCP server is currently configured and scoped to one project only (${grant.projectId}). ` +
        'Project management tools have been removed. All remaining tools are scoped to this project and can only interact with it. ' +
        'This is intentional. If the user requests changes to another project, inform them about the project-scoping configuration. ' +
        'The user can remove project scoping by removing the projectId query param from the MCP server URL, ' +
        'and by logging out and back in after removing the param when using OAuth.',
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

/**
 * Get the final list of available tools after applying grant context and
 * read-only filtering, with access-control notices appended to each tool's
 * `description`. This is what the MCP server (server/index.ts) and the MCP
 * transport route ([transport]/route.ts) register so LLM clients see the
 * notice inline alongside the tool descriptions.
 *
 * For the REST `/api/list-tools` endpoint, prefer `getFilteredTools` +
 * `getAccessControlNotices` separately to avoid duplicating the notice block
 * across every tool description.
 */
export function getAvailableTools(
  grant: GrantContext,
  readOnly: boolean,
): NeonTool[] {
  const tools = getFilteredTools(grant, readOnly);
  const notices = getAccessControlNotices(grant, readOnly);
  if (notices.length === 0) return tools;

  const noticesSuffix = `\n\n<notice>\n${notices.join('\n\n')}\n</notice>`;
  return tools.map((tool) => ({
    ...tool,
    description: `${tool.description}${noticesSuffix}`,
  }));
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
      ? 'No tools are available.'
      : 'Only the "search" and "fetch" tools are available.';
    warnings.push(
      '⚠️ Warning: No valid scope categories are set. ' +
        `${discoveryToolsText} ` +
        'Add scope categories via the category query param (e.g., "?category=querying&category=schema") ' +
        'to enable additional tools.',
    );
  }

  return warnings;
}

/**
 * Inject the granted project id into tool call args when in project-scoped mode.
 * Host tools receive root `projectId`. Generated tools receive `path.project_id`.
 */
export function injectProjectId(
  args: Record<string, unknown>,
  grant: GrantContext,
  tool?: Pick<NeonTool, 'kind' | 'projectScoped'>,
): Record<string, unknown> {
  if (!grant.projectId) return args;
  if (tool && !tool.projectScoped) return args;
  if (tool?.kind === 'generated') {
    const path = isPlainObject(args.path) ? args.path : {};
    return {
      ...args,
      path: { ...path, project_id: grant.projectId },
    };
  }
  return { ...args, projectId: grant.projectId };
}
