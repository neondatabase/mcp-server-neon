/**
 * Tool filtering based on grant context.
 *
 * Handles:
 * - Scope-category-based filtering
 * - Project-scoped mode: hiding project-agnostic tools and removing projectId from schemas
 */

import { z } from 'zod/v3';
import type { GrantContext, ScopeCategory } from '../utils/grant-context';
import { NEON_TOOLS } from './definitions';

type NeonTool = (typeof NEON_TOOLS)[number];

/**
 * Tools that are hidden when in project-scoped mode.
 * These tools don't make sense when the agent is scoped to a single project.
 */
const PROJECT_AGNOSTIC_TOOLS: ReadonlySet<string> = new Set([
  'list_projects',
  'list_organizations',
  'list_shared_projects',
  'create_project',
  'delete_project',
]);

/**
 * Additional tools hidden in project-scoped mode.
 */
const PROJECT_SCOPED_EXCLUDED_TOOLS: ReadonlySet<string> = new Set([
  'search',
  'fetch',
]);

/**
 * Tools that are always available regardless of scope categories.
 * These are discovery/navigation tools the LLM needs to function.
 */
const ALWAYS_AVAILABLE_TOOLS: ReadonlySet<string> = new Set([
  'search',
  'fetch',
]);

/**
 * Filter tools based on the grant context.
 *
 * Returns a new array of tools with:
 * 1. Scope-category filtering applied
 * 2. Project-agnostic tools removed (if project-scoped)
 * 3. projectId removed from schemas (if project-scoped)
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
    // Header was present but no valid categories were supplied.
    return tools.filter((tool) => ALWAYS_AVAILABLE_TOOLS.has(tool.name));
  }

  const scopeSet = new Set(scopes);

  return tools.filter((tool) => {
    // Always-available tools pass through
    if (ALWAYS_AVAILABLE_TOOLS.has(tool.name)) return true;
    // Tools without a scope are always available
    if (!tool.scope) return true;
    // Check if tool's scope category is in the enabled set
    return scopeSet.has(tool.scope);
  });
}

/**
 * Apply project-scoped filtering.
 * When a projectId is set, hide project-agnostic tools, hide
 * excluded discovery tools, and remove projectId from tool schemas.
 */
function applyProjectScopeFilter(
  tools: NeonTool[],
  grant: GrantContext,
): NeonTool[] {
  if (!grant.projectId) return tools;

  return tools
    .filter(
      (tool) =>
        !PROJECT_AGNOSTIC_TOOLS.has(tool.name) &&
        !PROJECT_SCOPED_EXCLUDED_TOOLS.has(tool.name),
    )
    .map((tool) => {
      const modified = removeProjectIdFromSchema(tool);
      return modified ?? tool;
    });
}

/**
 * Remove projectId from a tool's input schema if present.
 * Returns a new tool object with the modified schema, or null if no modification needed.
 *
 * Uses Zod's shape manipulation to create a new schema without the projectId field.
 */
function removeProjectIdFromSchema(tool: NeonTool): NeonTool | null {
  const schema = tool.inputSchema;

  if (schema instanceof z.ZodEffects) {
    const innerSchema = schema.innerType();
    if (!(innerSchema instanceof z.ZodObject)) return null;

    const shape = innerSchema.shape as Record<string, z.ZodTypeAny>;
    if (!('projectId' in shape)) return null;

    const objectSchema = innerSchema as z.ZodObject<
      Record<string, z.ZodTypeAny>
    >;
    const strippedInnerSchema = objectSchema.omit({ projectId: true });
    const newSchema = strippedInnerSchema.superRefine((val: unknown, ctx) => {
      const result = schema.safeParse({
        projectId: '__project_scoped__',
        ...(val as Record<string, unknown>),
      });
      if (result.success) return;
      for (const issue of result.error.issues) {
        ctx.addIssue(issue);
      }
    });

    return {
      ...tool,
      inputSchema: newSchema,
    } as NeonTool;
  }

  // Only Zod objects can have keys removed.
  if (!(schema instanceof z.ZodObject)) return null;

  const shape = schema.shape as Record<string, z.ZodTypeAny>;
  if (!('projectId' in shape)) return null;

  const objectSchema = schema as z.ZodObject<Record<string, z.ZodTypeAny>>;
  const newSchema = objectSchema.omit({ projectId: true });

  return {
    ...tool,
    inputSchema: newSchema,
  } as NeonTool;
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
        'The user can remove read-only mode by removing the readonly query param from the MCP server URL, ' +
        'or by logging out and back in with OAuth and selecting full access.',
    );
  } else {
    // Safety notice: only fires when destructive tools survive the grant filter
    // (e.g., the `docs` scope exposes no destructive tools, so no notice).
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
  return tools.map(
    (tool) =>
      ({
        ...tool,
        description: `${tool.description}${noticesSuffix}`,
      }) as NeonTool,
  );
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

  // X-Neon-Scopes was provided but no valid scope categories were recognized.
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
 * Inject projectId into tool call args when in project-scoped mode.
 * This should be called before passing args to the tool handler.
 */
export function injectProjectId(
  args: Record<string, unknown>,
  grant: GrantContext,
): Record<string, unknown> {
  if (!grant.projectId) return args;
  return { ...args, projectId: grant.projectId };
}
