function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function omitRolePassword(role: unknown): unknown {
  if (!isPlainObject(role)) return role;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(role)) {
    if (key !== 'password') {
      next[key] = value;
    }
  }
  return next;
}

/**
 * Create-project and create-branch 201s include connection_uris and
 * passwords on the roles array. get_connection_string is the write-mode
 * path for a URI. Role create/reset keep a top-level role.password;
 * that is the result of those tools.
 */
export function sanitizeGeneratedResult(data: unknown): unknown {
  if (!isPlainObject(data)) {
    return data;
  }

  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === 'connection_uris') continue;
    next[key] =
      key === 'roles' && Array.isArray(value)
        ? value.map(omitRolePassword)
        : value;
  }
  return next;
}
