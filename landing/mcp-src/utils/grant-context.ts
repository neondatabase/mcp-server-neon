import { parseResourceIdentifier } from '../../lib/oauth/protected-resource-metadata';

/**
 * Grant context for fine-grained tool access control.
 *
 * Supports per-category scope control and project scoping.
 *
 * Grant context can be resolved from:
 * - OAuth resource URI query params (authorize-time)
 * - OAuth token grant field (runtime)
 * - Direct MCP URL query params for API key auth (runtime)
 */

export const SCOPE_CATEGORIES = [
  'projects',
  'branches',
  'schema',
  'querying',
  'neon_auth',
  'data_api',
  'docs',
] as const;

export type ScopeCategory = (typeof SCOPE_CATEGORIES)[number];

export type GrantContext = {
  /** Single project ID for project-scoped access, or null for all projects. */
  projectId: string | null;
  /** Scope categories. null means all categories are allowed. */
  scopes: ScopeCategory[] | null;
};

/**
 * The default grant context when no query params or token grant is provided.
 * Full access and no project scoping.
 */
export const DEFAULT_GRANT: GrantContext = {
  projectId: null,
  scopes: null,
};

function isValidScopeCategory(value: string): value is ScopeCategory {
  return SCOPE_CATEGORIES.includes(value as ScopeCategory);
}

/**
 * Parse scope categories from a comma-separated string.
 *
 * - "projects,branches,querying" -> ['projects', 'branches', 'querying']
 * - Invalid values are silently filtered out.
 * - If the input is present but all values are invalid, returns [] (empty array).
 *   This results in no scoped tools (except always-available ones).
 * - If the input is absent (null/undefined/empty), returns null.
 */
export function parseScopeCategories(
  value: string | null | undefined,
): ScopeCategory[] | null {
  if (!value) return null;

  const categories = value
    .split(',')
    .map((s) => s.trim())
    .filter(isValidScopeCategory);

  return categories;
}

/**
 * Resolve grant context from URL search params.
 *
 * Supports both repeated params (?category=a&category=b) and
 * comma-separated values (?category=a,b).
 */
export function resolveGrantFromSearchParams(
  params: URLSearchParams,
): GrantContext {
  const rawCategories = params.getAll('category');
  const allCategories = rawCategories.flatMap((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const scopes =
    allCategories.length > 0
      ? allCategories.filter(isValidScopeCategory)
      : null;
  const projectId = params.get('projectId')?.trim() || null;
  return { projectId, scopes };
}

/**
 * Resolve grant context from an OAuth resource URI.
 *
 * RFC 8707 allows query params in resource URIs when they are used to scope
 * application access. We use `category` and `projectId` query params for this.
 */
export function resolveGrantFromResourceUri(
  resource: string | null | undefined,
): GrantContext {
  if (!resource) {
    return { ...DEFAULT_GRANT };
  }

  const resourceUrl = parseResourceIdentifier(resource);

  return resolveGrantFromSearchParams(resourceUrl.searchParams);
}

/**
 * Resolve grant context from a stored OAuth token.
 * If the token has a grant field, use it. Otherwise, fall back to defaults.
 */
export function resolveGrantFromToken(token: {
  grant?: GrantContext;
}): GrantContext {
  if (token.grant) {
    return {
      projectId: token.grant.projectId ?? null,
      scopes: token.grant.scopes ?? null,
    };
  }
  return { ...DEFAULT_GRANT };
}
