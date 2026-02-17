/**
 * Grant context for fine-grained tool access control.
 *
 * Supports four presets (local_development, production_use, full_access, custom)
 * and per-category scope control for the custom preset.
 *
 * Grant context can be resolved from:
 * - X-Neon-* HTTP headers (API key mode)
 * - CLI flags (stdio mode)
 * - OAuth token grant field (OAuth mode)
 * - Future: neon:mcp claims in ID token
 */

export const PRESETS = [
  'local_development',
  'production_use',
  'full_access',
  'custom',
] as const;

export type Preset = (typeof PRESETS)[number];

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

/**
 * Default branch names considered "production" when protect-production is set to "true".
 */
export const DEFAULT_PROTECTED_BRANCHES = [
  'main',
  'master',
  'prod',
  'production',
];

export type GrantContext = {
  /** Single project ID for project-scoped access, or null for all projects. */
  projectId: string | null;
  /** The active preset determining tool access level. */
  preset: Preset;
  /** Scope categories for custom preset. null = determined by preset (all categories). */
  scopes: ScopeCategory[] | null;
  /** Branch names to protect from destructive operations. null = no protection. */
  protectedBranches: string[] | null;
};

/**
 * The default grant context when no headers, flags, or token grant is provided.
 * Full access, no project scoping, no branch protection.
 */
export const DEFAULT_GRANT: GrantContext = {
  projectId: null,
  preset: 'full_access',
  scopes: null,
  protectedBranches: null,
};

function isValidPreset(value: string): value is Preset {
  return PRESETS.includes(value as Preset);
}

function isValidScopeCategory(value: string): value is ScopeCategory {
  return SCOPE_CATEGORIES.includes(value as ScopeCategory);
}

/**
 * Parse the X-Neon-Protect-Production header value.
 *
 * - "true" -> DEFAULT_PROTECTED_BRANCHES
 * - "false" or empty -> null (no protection)
 * - "branch-a,branch-b" -> ['branch-a', 'branch-b']
 * - "staging" -> ['staging']
 */
export function parseProtectedBranches(
  value: string | null | undefined,
): string[] | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'false') return null;
  if (trimmed.toLowerCase() === 'true') return [...DEFAULT_PROTECTED_BRANCHES];

  return trimmed
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean);
}

/**
 * Parse the X-Neon-Scopes header value into an array of valid scope categories.
 *
 * - "projects,branches,querying" -> ['projects', 'branches', 'querying']
 * - Invalid values are silently filtered out.
 * - If the header is present but all values are invalid, returns [] (empty array).
 *   This triggers `custom` preset with no tools (except always-available ones).
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
 *
 * Precedence rules:
 * - If X-Neon-Scopes is present, preset is always "custom" (X-Neon-Preset ignored)
 * - If only X-Neon-Preset is present, use that preset
 * - If neither is present, default to "full_access"
 */
export function resolveGrantFromHeaders(headers: Headers): GrantContext {
  const scopesHeader = headers.get('x-neon-scopes');
  const presetHeader = headers.get('x-neon-preset');
  const projectIdHeader = headers.get('x-neon-project-id');
  const protectProductionHeader = headers.get('x-neon-protect-production');

  const scopes = parseScopeCategories(scopesHeader);
  const protectedBranches = parseProtectedBranches(protectProductionHeader);
  const projectId = projectIdHeader?.trim() || null;

  // X-Neon-Scopes header presence always implies custom preset (even if empty/all-invalid)
  if (scopes !== null) {
    return {
      projectId,
      preset: 'custom',
      scopes,
      protectedBranches,
    };
  }

  // X-Neon-Preset without scopes
  const preset =
    presetHeader && isValidPreset(presetHeader) ? presetHeader : 'full_access';

  return {
    projectId,
    preset,
    scopes: null,
    protectedBranches,
  };
}

/**
 * CLI grant arguments parsed from command-line flags.
 */
/**
 * Resolve grant context from CLI flags (stdio mode).
 *
 * Same precedence as headers:
 * - --scopes implies custom preset
 * - --preset without --scopes uses the specified preset
 */
export function resolveGrantFromCliArgs(args: {
  preset?: string;
  scopes?: string;
  projectId?: string;
  protectProduction?: string;
}): GrantContext {
  const scopes = parseScopeCategories(args.scopes ?? null);
  const protectedBranches = parseProtectedBranches(
    args.protectProduction ?? null,
  );
  const projectId = args.projectId?.trim() || null;

  if (scopes) {
    return {
      projectId,
      preset: 'custom',
      scopes,
      protectedBranches,
    };
  }

  const preset =
    args.preset && isValidPreset(args.preset) ? args.preset : 'full_access';

  return {
    projectId,
    preset,
    scopes: null,
    protectedBranches,
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
