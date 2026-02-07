import type { GrantContext } from './grant-context';

export const SUPPORTED_SCOPES = ['read', 'write', '*'] as const;

export const SCOPE_DEFINITIONS = {
  read: {
    label: 'Read-only',
    description: 'View Neon resources and run read-only queries',
  },
  write: {
    label: 'Full access',
    description:
      'Allow full management of your Neon resources and databases, including running any INSERT, UPDATE, or DELETE statements',
  },
} as const;

export type ReadOnlyContext = {
  /** Value of the X-Neon-Read-Only header (canonical). */
  neonHeaderValue?: string | null;
  /** Value of the legacy x-read-only header (backwards-compatible synonym). */
  headerValue?: string | null;
  scope?: string | string[] | null;
  grant?: GrantContext;
};

function normalizeScope(scope: string | string[] | null | undefined): string[] {
  if (!scope) return [];
  if (Array.isArray(scope)) return scope.filter(Boolean);
  return scope.split(' ').filter(Boolean);
}

/**
 * Checks if the scope includes write access ('write' or '*').
 */
export function hasWriteScope(scope: string | string[] | null | undefined): boolean {
  const scopes = normalizeScope(scope);
  return scopes.some((s) => s === 'write' || s === '*');
}

function isScopeReadOnly(scope: string | string[] | null | undefined): boolean {
  const scopes = normalizeScope(scope);
  if (scopes.length === 0) return false;
  return !hasWriteScope(scopes);
}

function parseReadOnlyHeader(
  headerValue: string | null | undefined
): boolean | undefined {
  if (headerValue === null || headerValue === undefined) {
    return undefined;
  }
  return headerValue.trim().toLowerCase() === 'true';
}

/**
 * Determines if the request should operate in read-only mode.
 * Priority: X-Neon-Read-Only > x-read-only > grant preset > OAuth scope > default (false)
 */
export function isReadOnly(context: ReadOnlyContext): boolean {
  // Priority 1: X-Neon-Read-Only header (canonical)
  const neonResult = parseReadOnlyHeader(context.neonHeaderValue);
  if (neonResult !== undefined) {
    return neonResult;
  }

  // Priority 2: x-read-only header (legacy synonym)
  const legacyResult = parseReadOnlyHeader(context.headerValue);
  if (legacyResult !== undefined) {
    return legacyResult;
  }

  // Priority 3: Grant preset (production_use = read-only)
  if (context.grant?.preset === 'production_use') {
    return true;
  }

  // Priority 4: OAuth scope
  if (context.scope !== undefined && context.scope !== null) {
    return isScopeReadOnly(context.scope);
  }

  return false;
}
