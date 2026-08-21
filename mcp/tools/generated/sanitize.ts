import type { GeneratedOperationId } from './operations';

const KEEP_ROLE_PASSWORD = new Set<GeneratedOperationId>([
  'createProjectBranchRole',
  'resetProjectBranchRolePassword',
]);

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
 * Create payloads omit connection_uris and roles[].password because
 * get_connection_string owns URI retrieval. GET role may include a stored
 * password; only role create/reset keep role.password as their result.
 */
export function sanitizeGeneratedResult(
  operationId: GeneratedOperationId,
  data: unknown,
): unknown {
  if (!isPlainObject(data)) {
    return data;
  }

  const keepRolePassword = KEEP_ROLE_PASSWORD.has(operationId);
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === 'connection_uris') continue;
    if (key === 'roles' && Array.isArray(value)) {
      next[key] = value.map(omitRolePassword);
      continue;
    }
    if (key === 'role' && !keepRolePassword) {
      next[key] = omitRolePassword(value);
      continue;
    }
    next[key] = value;
  }
  return next;
}
