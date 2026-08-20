import type { GeneratedOperationId } from './operations';

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
 * create_project's API 201 includes connection_uris and role passwords.
 * The published tool description says it does not return a connection
 * string; get_connection_string is the write-mode path for that.
 */
export function sanitizeGeneratedResult(
  operationId: GeneratedOperationId,
  data: unknown,
): unknown {
  if (operationId !== 'createProject' || !isPlainObject(data)) {
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
