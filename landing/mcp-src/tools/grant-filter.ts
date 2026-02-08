/**
 * Tool filtering based on grant context.
 *
 * Handles:
 * - Preset-based tool filtering (local_development, production_use, full_access, custom)
 * - Scope-category-based filtering (for custom preset)
 * - Project-scoped mode: hiding project-agnostic tools and removing projectId from schemas
 */

import { z } from 'zod';
import type { GrantContext, ScopeCategory } from '../utils/grant-context';
import { NEON_TOOLS } from './definitions';

export type NeonTool = (typeof NEON_TOOLS)[number];

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
 * Tools that are always available regardless of scope categories.
 * These are discovery/navigation tools the LLM needs to function.
 */
const ALWAYS_AVAILABLE_TOOLS: ReadonlySet<string> = new Set([
  'search',
  'fetch',
]);

/**
 * Tools blocked by the local_development preset.
 * Project creation and deletion are disabled for safe development.
 */
const LOCAL_DEV_BLOCKED_TOOLS: ReadonlySet<string> = new Set([
  'create_project',
  'delete_project',
]);

/**
 * Filter tools based on the grant context.
 *
 * Returns a new array of tools with:
 * 1. Preset-based filtering applied
 * 2. Project-agnostic tools removed (if project-scoped)
 * 3. projectId removed from schemas (if project-scoped)
 */
export function filterToolsForGrant(
  tools: readonly NeonTool[],
  grant: GrantContext,
): NeonTool[] {
  let filtered = applyPresetFilter(tools, grant);
  filtered = applyProjectScopeFilter(filtered, grant);
  return filtered;
}

/**
 * Apply preset-based filtering.
 */
function applyPresetFilter(
  tools: readonly NeonTool[],
  grant: GrantContext,
): NeonTool[] {
  switch (grant.preset) {
    case 'full_access':
      return [...tools];

    case 'production_use':
      // Only read-safe tools
      return tools.filter(
        (tool) => tool.readOnlySafe || ALWAYS_AVAILABLE_TOOLS.has(tool.name),
      );

    case 'local_development':
      // Everything except project create/delete
      return tools.filter(
        (tool) => !LOCAL_DEV_BLOCKED_TOOLS.has(tool.name),
      );

    case 'custom':
      // Filter by scope categories
      return applyCustomScopeFilter(tools, grant.scopes);
  }
}

/**
 * Filter tools by scope categories (custom preset).
 */
function applyCustomScopeFilter(
  tools: readonly NeonTool[],
  scopes: ScopeCategory[] | null,
): NeonTool[] {
  if (!scopes || scopes.length === 0) {
    // No scopes specified with custom preset = no tools (except always-available)
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
 * When a projectId is set, hide project-agnostic tools and
 * remove projectId from tool schemas.
 */
function applyProjectScopeFilter(
  tools: NeonTool[],
  grant: GrantContext,
): NeonTool[] {
  if (!grant.projectId) return tools;

  return tools
    .filter((tool) => !PROJECT_AGNOSTIC_TOOLS.has(tool.name))
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

  // Only Zod objects can have keys removed
  if (!(schema instanceof z.ZodObject)) return null;

  const shape = schema.shape as Record<string, z.ZodTypeAny>;
  if (!('projectId' in shape)) return null;

  // Build a new shape without projectId
  const newShape: Record<string, z.ZodTypeAny> = {};
  for (const [key, value] of Object.entries(shape)) {
    if (key !== 'projectId') {
      newShape[key] = value;
    }
  }

  const newSchema = z.object(newShape);

  return {
    ...tool,
    inputSchema: newSchema,
  } as NeonTool;
}

/**
 * Get the final list of available tools after applying grant context and read-only filtering.
 *
 * This is the single source of truth for tool availability, used by:
 * - The MCP server (server/index.ts) at registration time
 * - The /api/list-tools REST endpoint for previewing tool visibility
 *
 * Combines two filtering stages:
 * 1. Grant-based filtering (presets, custom scopes, project scoping)
 * 2. Read-only filtering (strips non-readOnlySafe tools when read-only is active)
 */
export function getAvailableTools(
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
 * Build warning messages for access control edge cases.
 *
 * Returns human-readable warnings (using ⚠️ prefix) that should be
 * appended to tool call responses so the LLM is aware of
 * contradictory or potentially confusing configurations.
 */
export function getAccessControlWarnings(
  grant: GrantContext,
  readOnly: boolean,
): string[] {
  const warnings: string[] = [];

  // readOnly explicitly set to false but production_use preset already
  // restricts to read-only tools — the readOnly flag has no additional effect.
  if (!readOnly && grant.preset === 'production_use') {
    warnings.push(
      '⚠️ Warning: Read-only mode is set to false, but the "production_use" preset ' +
        'already restricts tools to the read-only set. ' +
        'The read-only flag has no additional effect with this preset.',
    );
  }

  // custom preset with null or empty scopes = nearly locked out (only search + fetch).
  // This typically means X-Neon-Preset: custom was sent without X-Neon-Scopes,
  // or all scope values were invalid.
  if (
    grant.preset === 'custom' &&
    (!grant.scopes || grant.scopes.length === 0)
  ) {
    warnings.push(
      '⚠️ Warning: The "custom" preset is active but no valid scope categories are set. ' +
        'Only the "search" and "fetch" tools are available. ' +
        'Add scope categories via the X-Neon-Scopes header (e.g., "querying,schema") ' +
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

  // Only inject if the tool would normally accept a projectId
  // The handler expects it even though it was removed from the schema
  return { ...args, projectId: grant.projectId };
}
