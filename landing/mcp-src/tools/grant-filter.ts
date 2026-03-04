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
 * 1. Grant-based filtering (scope categories + project scoping)
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
  _readOnly: boolean,
): string[] {
  void _readOnly;
  const warnings: string[] = [];

  // X-Neon-Scopes was provided but no valid scope categories were recognized.
  if (grant.scopes !== null && grant.scopes.length === 0) {
    warnings.push(
      '⚠️ Warning: No valid scope categories are set. ' +
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
