import { randomUUID } from 'crypto';
import { isInitializeRequest } from '@modelcontextprotocol/server';
import { Effect } from 'effect';
import { tagRequestSession } from '../sentry/session';

/**
 * 2025-era Streamable HTTP lets a server assign a session id on the response
 * to `initialize`; clients then send it on every request of that connection.
 * The server stores nothing under it and never rejects an unknown one: it
 * exists so the calls of one connection can be found together in Sentry.
 * Revision 2026-07-28 has no sessions and no `initialize`, so it never gets one.
 */
const MCP_SESSION_ID_HEADER = 'mcp-session-id';

// The spec allows visible ASCII only; the length cap bounds what a client can
// put on every span and log line.
const SESSION_ID_PATTERN = /^[\x21-\x7E]{1,128}$/;

function validId(value: unknown): string | undefined {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value)
    ? value
    : undefined;
}

const readSessionId = (headers: Headers): string | undefined =>
  validId(headers.get(MCP_SESSION_ID_HEADER));

/** Codex sends its conversation's thread id as `_meta.threadId` on every `tools/call`. */
export function conversationIdFromMeta(
  meta: Record<string, unknown> | undefined,
): string | undefined {
  return validId(meta?.threadId);
}

type McpSession = {
  readonly id?: string;
  /** Set when this response must hand the client its new session id. */
  readonly minted?: string;
};

// Not JSON: the MCP SDK answers it with a parse error.
const isInitialize = (text: string): boolean => {
  try {
    return isInitializeRequest(JSON.parse(text));
  } catch {
    return false;
  }
};

/**
 * The session id the client sent, or a new one when this is a 2025-era
 * `initialize` without one. Only a request without an id has its body read,
 * from a clone, to recognise `initialize`.
 */
const resolveMcpSession = Effect.fnUntraced(function* (req: Request) {
  const sent = readSessionId(req.headers);

  if (sent !== undefined || req.method !== 'POST') {
    return { id: sent } satisfies McpSession;
  }

  const body = yield* Effect.promise(async () => req.clone().text());

  if (!isInitialize(body)) {
    return {} satisfies McpSession;
  }

  const id = randomUUID();

  return { id, minted: id } satisfies McpSession;
});

const withSessionHeader = (response: Response, sessionId: string) => {
  const headers = new Headers(response.headers);

  headers.set(MCP_SESSION_ID_HEADER, sessionId);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

/**
 * Tags the request's telemetry with its session and hands a new session id
 * back on the `initialize` response. On the authenticated route this runs
 * after the token check, so a rejected request's body is never read here.
 */
export const withMcpSession = Effect.fnUntraced(function* <E, R>(
  req: Request,
  serve: Effect.Effect<Response, E, R>,
) {
  const session: McpSession = yield* resolveMcpSession(req);

  if (session.id !== undefined) {
    yield* tagRequestSession(session.id);
  }

  const response = yield* serve;

  return session.minted === undefined || !response.ok
    ? response
    : withSessionHeader(response, session.minted);
});
