import { randomUUID } from 'crypto';

/**
 * 2025-era Streamable HTTP lets a server assign a session id on the response
 * to `initialize`; clients then send it on every request of that connection.
 * The server stores nothing under it and never rejects an unknown one: it
 * exists so the calls of one connection can be found together in Sentry.
 * Revision 2026-07-28 has no sessions and no `initialize`, so it never gets one.
 */
export const MCP_SESSION_ID_HEADER = 'mcp-session-id';

// The spec allows visible ASCII only; the length cap bounds what a client can
// put on every span and log line.
const SESSION_ID_PATTERN = /^[\x21-\x7E]{1,128}$/;

function validId(value: unknown): string | undefined {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value)
    ? value
    : undefined;
}

export function readSessionId(
  headers: Headers | undefined,
): string | undefined {
  return validId(headers?.get(MCP_SESSION_ID_HEADER));
}

export function mintSessionId(): string {
  return randomUUID();
}

/** Codex sends its conversation's thread id as `_meta.threadId` on every `tools/call`. */
export function conversationIdFromMeta(
  meta: Record<string, unknown> | undefined,
): string | undefined {
  return validId(meta?.threadId);
}
