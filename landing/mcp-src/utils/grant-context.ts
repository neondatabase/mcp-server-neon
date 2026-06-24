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
 * Returns true when the request is a strict docs-only MCP request:
 * exactly one `category=docs` value and no `projectId`.
 *
 * This is the trigger for the anonymous (no-OAuth) docs endpoint.
 * Any other category combination (or a projectId) keeps the standard
 * authenticated flow.
 */
export function isDocsOnlyRequest(params: URLSearchParams): boolean {
  const categories = params.getAll('category').flatMap((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const projectId = params.get('projectId')?.trim();
  return categories.length === 1 && categories[0] === 'docs' && !projectId;
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

/**
 * Compare two grant contexts for re-consent purposes. Used by the OAuth
 * authorize handler's pre-approval short-circuit so that an MCP client
 * that previously got consented for one grant shape (e.g. unconstrained
 * access) cannot use the same approval cookie to silently expand into a
 * different shape (e.g. narrower categories or a different projectId).
 * When the resource URI's grant shape differs from what was stored at
 * approval time, the authorize handler re-shows the consent screen so
 * the user explicitly approves the new shape.
 *
 * Equivalence is computed against the underlying SETS of scope categories
 * (not array length). An earlier version compared `aScopes.length`
 * directly which produced false positives when one side carried duplicate
 * `?category=querying&category=querying` values: e.g. stored
 * `['querying', 'schema']` vs incoming `['querying', 'querying']` both
 * have length 2, but they describe different category sets. Going
 * through `Set.size` collapses duplicates, and
 * `Set.prototype.isSubsetOf` (paired with the size check) gives proper
 * set equality.
 *
 * Treats `scopes === null` (unconstrained, every category — including
 * future ones) as distinct from `scopes === [...all current categories]`
 * (an explicit list, even if it currently spans every category) on
 * purpose: a future category addition would silently widen a
 * `null`-grant approval but not an explicit-list one. The user must
 * re-consent across that boundary.
 */
export function grantsAreEquivalent(
  a: GrantContext | undefined,
  b: GrantContext,
): boolean {
  if (!a) return false;

  const aScopes = a.scopes;
  const bScopes = b.scopes;

  if ((aScopes === null) !== (bScopes === null)) return false;

  if (aScopes !== null && bScopes !== null) {
    const setA = new Set(aScopes);
    const setB = new Set(bScopes);
    if (setA.size !== setB.size || !setA.isSubsetOf(setB)) return false;
  }

  return (a.projectId ?? null) === (b.projectId ?? null);
}
