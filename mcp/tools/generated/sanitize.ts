import type { GeneratedToolId } from './operations';

const KEEP_ROLE_PASSWORD = new Set<GeneratedToolId>([
  'postgres.roles.create',
  'postgres.roles.resetPassword',
]);

const DROP_KEYS = new Set([
  'connection_uris',
  'connectionString',
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

export function sanitizeGeneratedResult(
  toolId: GeneratedToolId,
  data: unknown,
): unknown {
  return sanitizeValue(toolId, data);
}

function sanitizeValue(toolId: GeneratedToolId, data: unknown): unknown {
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeValue(toolId, item));
  }
  if (!isPlainObject(data)) {
    return data;
  }

  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (DROP_KEYS.has(key)) continue;
    if (key === 'password' && !KEEP_ROLE_PASSWORD.has(toolId)) continue;
    if (key === 'roles' && Array.isArray(value)) {
      next[key] = value.map(omitRolePassword);
      continue;
    }
    if (key === 'role') {
      next[key] = KEEP_ROLE_PASSWORD.has(toolId)
        ? value
        : omitRolePassword(value);
      continue;
    }
    next[key] = sanitizeValue(toolId, value);
  }
  return next;
}
