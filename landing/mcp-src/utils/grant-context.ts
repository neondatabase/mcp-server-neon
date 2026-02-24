/**
 * Grant context for fine-grained tool access control.
 *
 * Supports per-category scope control and project scoping.
 *
 * Grant context can be resolved from:
 * - X-Neon-* HTTP headers (API key mode)
 * - CLI flags (stdio mode)
 * - OAuth token grant field (OAuth mode)
 * - Future: neon:mcp claims in ID token
 */

export const SCOPE_CATEGORIES = [
  'projects',
  'branches',
  'schema',
  'querying',
  'performance',
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
 * The default grant context when no headers, flags, or token grant is provided.
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
 * Parse the X-Neon-Scopes header value into an array of valid scope categories.
 *
 * - "projects,branches,querying" -> ['projects', 'branches', 'querying']
 * - Invalid values are silently filtered out.
 * - If the header is present but all values are invalid, returns [] (empty array).
 *   This results in no scoped tools (except always-available ones).
 * - If the header is absent (null/undefined/empty), returns null.
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
 * Resolve grant context from HTTP headers (API key mode).
 */
export function resolveGrantFromHeaders(headers: Headers): GrantContext {
  const scopesHeader = headers.get('x-neon-scopes');
  const projectIdHeader = headers.get('x-neon-project-id');

  const scopes = parseScopeCategories(scopesHeader);
  const projectId = projectIdHeader?.trim() || null;

  return {
    projectId,
    scopes,
  };
}

/**
 * CLI grant arguments parsed from command-line flags.
 */
/**
 * Resolve grant context from CLI flags (stdio mode).
 *
 * Supports project and scope-category flags only.
 */
export function resolveGrantFromCliArgs(args: {
  scopes?: string;
  projectId?: string;
}): GrantContext {
  const scopes = parseScopeCategories(args.scopes ?? null);
  const projectId = args.projectId?.trim() || null;

  return {
    projectId,
    scopes,
  };
}

/**
 * Resolve grant context from a stored OAuth token.
 * If the token has a grant field, use it. Otherwise, fall back to defaults.
 */
export function resolveGrantFromToken(token: {
  grant?: GrantContext;
}): GrantContext {
  if (token.grant) {
    return token.grant;
  }
  return { ...DEFAULT_GRANT };
}
