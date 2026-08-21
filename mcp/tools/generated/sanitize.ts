import type { GeneratedOperationId, WorkflowToolId } from './operations';

type SanitizedToolId = GeneratedOperationId | WorkflowToolId;

const KEEP_ROLE_PASSWORD = new Set<SanitizedToolId>([
  'createProjectBranchRole',
  'resetProjectBranchRolePassword',
]);

const DROP_KEYS = new Set([
  'connection_uris',
  'secret_server_key',
  'client_secret',
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
 * Password-creation and connection workflows retain credentials because
 * returning the credential is the requested operation.
 */
export function sanitizeGeneratedResult(
  operationId: SanitizedToolId,
  data: unknown,
): unknown {
  return sanitizeValue(operationId, data);
}

function sanitizeValue(operationId: SanitizedToolId, data: unknown): unknown {
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeValue(operationId, item));
  }
  if (!isPlainObject(data)) {
    return data;
  }

  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (DROP_KEYS.has(key)) continue;
    if (key === 'password' && !KEEP_ROLE_PASSWORD.has(operationId)) continue;
    if (key === 'roles' && Array.isArray(value)) {
      next[key] = value.map(omitRolePassword);
      continue;
    }
    if (key === 'role') {
      next[key] = KEEP_ROLE_PASSWORD.has(operationId)
        ? value
        : omitRolePassword(value);
      continue;
    }
    next[key] = sanitizeValue(operationId, value);
  }
  return next;
}
