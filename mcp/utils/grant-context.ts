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
  'endpoints',
  'snapshots',
  'schema',
  'querying',
  'neon_auth',
  'data_api',
  'observability',
  'docs',
  'functions',
  'storage',
] as const;

export type ScopeCategory = (typeof SCOPE_CATEGORIES)[number];

export type GrantContext = {
  /** Single project ID for project-scoped access, or null for all projects. */
  projectId: string | null;
  /** Scope categories. null means all categories are allowed. */
  scopes: ScopeCategory[] | null;
  unknownCategories?: string[];
  /**
   * Postgres role every SQL connection authenticates as. Absent means the
   * database owner, as before this field existed.
   */
  roleName?: string;
};

/**
 * The default grant context when no query params or token grant is provided.
 * Full access and no project scoping.
 */
export const DEFAULT_GRANT: GrantContext = {
  projectId: null,
  scopes: null,
};

/**
 * Carried alongside `projectId`, `category` and `readonly`, so it is camelCase
 * like them.
 */
export const ROLE_NAME_PARAM = 'roleName';

// An unquoted Postgres identifier (NAMEDATALEN - 1 = 63 bytes). The value is
// passed to the Neon API as an exact role name, never interpolated into SQL.
const ROLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;

export class InvalidRoleNameError extends Error {
  constructor() {
    super(
      `Invalid ${ROLE_NAME_PARAM}: expected one Postgres role name (letters, digits, "_" or "$", starting with a letter or "_", at most 63 characters)`,
    );
    this.name = 'InvalidRoleNameError';
  }
}

export function isValidRoleName(value: unknown): value is string {
  return typeof value === 'string' && ROLE_NAME_PATTERN.test(value);
}

/**
 * A pinned role is a restriction, so a malformed one must not degrade to "no
 * pin": an empty, repeated or invalid `roleName` throws instead.
 */
export function parseRoleNameParam(
  params: URLSearchParams,
): string | undefined {
  const values = params.getAll(ROLE_NAME_PARAM);
  if (values.length === 0) return undefined;
  if (values.length > 1 || !isValidRoleName(values[0])) {
    throw new InvalidRoleNameError();
  }
  return values[0];
}

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
  const unknownCategories = allCategories.filter(
    (category) => !isValidScopeCategory(category),
  );
  const projectId = params.get('projectId')?.trim() || null;
  const roleName = parseRoleNameParam(params);
  return {
    projectId,
    scopes,
    ...(unknownCategories.length > 0 ? { unknownCategories } : {}),
    ...(roleName ? { roleName } : {}),
  };
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
 * application access. We use `category`, `projectId` and `roleName` query
 * params for this. Throws `InvalidRoleNameError` for a malformed `roleName`.
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
    return normalizeStoredGrant(token.grant);
  }
  return { ...DEFAULT_GRANT };
}

/**
 * Copy the known fields of a grant read back from storage. A stored `roleName`
 * that is present but no longer valid throws rather than being dropped, since
 * dropping it would widen the connection to the database owner.
 */
export function normalizeStoredGrant(
  grant: Partial<GrantContext>,
): GrantContext {
  if (grant.roleName !== undefined && !isValidRoleName(grant.roleName)) {
    throw new InvalidRoleNameError();
  }
  return {
    projectId: grant.projectId ?? null,
    scopes: grant.scopes ?? null,
    ...(grant.unknownCategories?.length
      ? { unknownCategories: grant.unknownCategories }
      : {}),
    ...(grant.roleName !== undefined ? { roleName: grant.roleName } : {}),
  };
}
