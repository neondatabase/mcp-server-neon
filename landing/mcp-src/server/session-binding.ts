import { createHash, timingSafeEqual } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { AuthContext } from '../types/auth';
import { logger } from '../utils/logger';

const SESSION_KEY_PREFIX = 'mcp:session:';
const REDIS_OP_TIMEOUT_MS = 500;

let clientPromise: Promise<RedisClientType> | null = null;

function withTimeout<T>(promise: Promise<T>, op: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`session-binding ${op} timed out`));
    }, REDIS_OP_TIMEOUT_MS);
    // Don't keep the process alive solely for this timer.
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Predicate for transient Redis failures that are worth retrying once. Matches:
 *
 *  - our own `withTimeout` rejection (`session-binding <op> timed out`),
 *    which is what surfaces when Upstash's tail latency exceeds our budget,
 *  - Node socket errors (`ECONNRESET`, `ETIMEDOUT`, `ECONNREFUSED`, `EPIPE`)
 *    emitted by the `redis` client when the underlying connection breaks,
 *  - `redis@4` lifecycle errors (`AbortError`, `ClientClosedError`,
 *    `SocketClosedUnexpectedlyError`) when a queued op is invalidated by a
 *    reconnect.
 *
 * Logic-layer errors (key not found, type mismatch) are NOT retried — those
 * are caller bugs, not transient infra.
 */
export function isRedisTransientFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.message.includes('timed out')) return true;
  const code = (err as { code?: unknown }).code;
  if (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'EPIPE'
  ) {
    return true;
  }
  if (
    err.name === 'AbortError' ||
    err.name === 'ClientClosedError' ||
    err.name === 'SocketClosedUnexpectedlyError'
  ) {
    return true;
  }
  return false;
}

/**
 * Drop the cached redis client so the next `getRedis()` rebuilds a fresh
 * connection. Used between retry attempts because `withTimeout` only races
 * a timer — it does not cancel the underlying op — so the previous socket
 * may still be blocked on the very call that timed out. Disconnect is
 * fire-and-forget; if the cached promise hasn't resolved yet, we just drop
 * the reference.
 */
function dropCachedRedis(): void {
  const cached = clientPromise;
  clientPromise = null;
  if (!cached) return;
  cached.then(
    (client) => {
      // Defensive: older redis client shapes may not expose disconnect.
      try {
        const result = client.disconnect?.();
        if (result && typeof result.catch === 'function') {
          result.catch(() => {
            /* ignore — point is just to release the stuck socket */
          });
        }
      } catch {
        /* ignore — best-effort cleanup */
      }
    },
    () => {
      /* cached promise already rejected; nothing to disconnect */
    },
  );
}

/**
 * Run a Redis-bound operation with a single retry on transient failures.
 * Between attempts, the cached client is dropped so the retry uses a fresh
 * socket — critical because the most common transient is a stuck Upstash
 * connection where the original op is still in-flight on the same socket.
 *
 * Same shape as `withPgConnectRetry` in `mcp-src/oauth/kv-store.ts`. Single
 * retry only; SSE is the hot path and we'd rather fail-closed than burn
 * budget on a deeper retry tree. Operations must be idempotent — get/set
 * with a fixed key/value satisfy this.
 */
async function withRedisRetry<T>(op: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isRedisTransientFailure(err)) throw err;
    dropCachedRedis();
    logger.warn(`session-binding ${op}: retrying after transient failure`, {
      err: err instanceof Error ? err.message : String(err),
    });
    return await fn();
  }
}

function getRedis(): Promise<RedisClientType> {
  if (clientPromise) return clientPromise;

  const url = process.env.KV_URL || process.env.REDIS_URL;
  if (!url) {
    return Promise.reject(
      new Error('KV_URL/REDIS_URL not set; session binding unavailable'),
    );
  }

  const client = createClient({ url }) as RedisClientType;
  client.on('error', (err) => {
    // Log and reset so the next call reconnects. An in-flight promise held by
    // a concurrent caller may still resolve to this (now-failing) client; that
    // caller's operation will reject naturally and the subsequent retry will
    // build a fresh client.
    logger.error('session-binding redis error', { err });
    clientPromise = null;
  });

  const pending = client.connect().then(() => client);
  // If the initial connect fails, clear the cached promise so future callers
  // don't inherit a permanently-rejected promise.
  pending.catch(() => {
    clientPromise = null;
  });
  clientPromise = pending;
  return clientPromise;
}

/**
 * Stable identity fingerprint for a caller. Binds the SSE session to the
 * (account, OAuth-client) pair so that a POST from a different account — or
 * the same account presenting credentials registered to a different OAuth
 * client — cannot inject into this SSE stream even if the sessionId leaks.
 *
 * Why `clientId` and not the bearer token: the bearer rotates on every
 * OAuth refresh (~hourly for Cursor and similar). Binding to the bearer
 * meant a legitimate same-client refresh broke the binding mid-stream and
 * surfaced as a 403 on the next POST /message — which Cursor's MCP client
 * interpreted as an auth failure and prompted the user to re-authenticate.
 * Binding to `clientId` (the dynamic OAuth registration assigned via
 * /api/register) keeps the identity stable across refreshes for the same
 * registered MCP client, while still mismatching cross-account or
 * cross-OAuth-client POSTs.
 *
 * For the API-key auth path, `clientId` is set to the literal `'api-key'`
 * upstream (see route.ts), so the binding effectively becomes
 * `(accountId, 'api-key')` — two API keys for the same account are no
 * longer distinguished by this signal. That's an intentional trade: the
 * public Neon API itself accepts any valid key for the account, so
 * disambiguating between keys here added no real defense.
 */
export function deriveIdentity(authInfo: AuthInfo | undefined): string | null {
  const extra = authInfo?.extra as AuthContext['extra'] | undefined;
  const accountId = extra?.account?.id;
  const clientId = authInfo?.clientId;
  if (!accountId || typeof clientId !== 'string') return null;
  return createHash('sha256')
    .update(`${accountId}:${clientId}`)
    .digest('hex')
    .slice(0, 32);
}

function sessionKey(sessionId: string): string {
  return `${SESSION_KEY_PREFIX}${sessionId}`;
}

/**
 * Write the {sessionId → caller identity} binding with the given TTL. The
 * caller is responsible for choosing a TTL ≥ the SSE stream's max lifetime so
 * that a POST arriving right before the stream ends still sees the binding.
 */
export async function bindSession(
  sessionId: string,
  identity: string,
  ttlSec: number,
): Promise<void> {
  await withRedisRetry('bind', async () => {
    const redis = await getRedis();
    return withTimeout(
      redis.set(sessionKey(sessionId), identity, { EX: ttlSec }),
      'set',
    );
  });
}

export async function verifySession(
  sessionId: string,
  identity: string,
): Promise<boolean> {
  const stored = await withRedisRetry('verify', async () => {
    const redis = await getRedis();
    return withTimeout(redis.get(sessionKey(sessionId)), 'get');
  });
  if (!stored) return false;
  const a = Buffer.from(stored);
  const b = Buffer.from(identity);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function releaseSession(sessionId: string): Promise<void> {
  await withRedisRetry('release', async () => {
    const redis = await getRedis();
    return withTimeout(redis.del(sessionKey(sessionId)), 'del');
  });
}

export type MessageOwnershipResult =
  | { kind: 'pass' }
  | { kind: 'not-applicable' }
  | { kind: 'reject'; status: 401 | 403 | 503; reason: string };

/**
 * Outcome buckets for the SSE session-binding security signal. Mirrors the
 * `[SLO] refresh outcome=...` shape used by /api/token so dashboards can grep
 * with the same pipeline. Unlike the refresh metric this is *not* an SLO with
 * a numerator/denominator target — `binding_missing` is mostly benign (stale
 * reconnects after server-side SSE timeouts) and `bound_ok` volume tracks tool
 * usage rather than user-experience health. The signal we actually alert on is
 * `binding_mismatch` and `envelope_mismatch`: any non-zero count is interesting
 * because the legitimate flow cannot produce them.
 */
export type SseBindOutcome =
  | 'bound_ok'
  | 'binding_missing'
  | 'binding_mismatch'
  | 'caller_unidentified'
  | 'redis_error'
  | 'envelope_mismatch';

export function emitSseBindOutcome(
  outcome: SseBindOutcome,
  ctx: {
    sessionId?: string | null;
    path?: string;
    invocation?: string;
    elapsedMs?: number;
  } = {},
): void {
  const parts = [`[SEC] sse-bind outcome=${outcome}`];
  if (ctx.sessionId) parts.push(`sessionId=${ctx.sessionId}`);
  if (ctx.invocation) parts.push(`invocation=${ctx.invocation}`);
  if (ctx.path) parts.push(`path=${ctx.path}`);
  if (typeof ctx.elapsedMs === 'number')
    parts.push(`elapsedMs=${ctx.elapsedMs}`);
  logger.info(parts.join(' '));
}

/**
 * Decides whether a POST to the SSE message endpoint is allowed to proceed.
 * Reads the Redis-backed session binding and returns `pass` only when the
 * caller's identity matches the binding stored under the provided sessionId.
 * Extracted from the route handler so the decision logic can be exercised
 * without spinning up the MCP handler.
 */
export async function evaluateMessageOwnership(
  method: string,
  pathname: string,
  sessionId: string | null,
  identity: string | null,
): Promise<MessageOwnershipResult> {
  if (method !== 'POST' || !pathname.endsWith('/message') || !sessionId) {
    return { kind: 'not-applicable' };
  }
  const start = Date.now();
  const baseCtx = { sessionId, path: pathname };
  if (!identity) {
    emitSseBindOutcome('caller_unidentified', {
      ...baseCtx,
      elapsedMs: Date.now() - start,
    });
    return {
      kind: 'reject',
      status: 401,
      reason: 'Caller identity unavailable',
    };
  }
  try {
    const stored = await withRedisRetry('verify', async () => {
      const redis = await getRedis();
      return withTimeout(redis.get(sessionKey(sessionId)), 'get');
    });
    if (stored === null) {
      emitSseBindOutcome('binding_missing', {
        ...baseCtx,
        elapsedMs: Date.now() - start,
      });
      return {
        kind: 'reject',
        status: 403,
        reason: 'Session binding not found',
      };
    }
    const a = Buffer.from(stored);
    const b = Buffer.from(identity);
    const matches = a.length === b.length && timingSafeEqual(a, b);
    if (!matches) {
      emitSseBindOutcome('binding_mismatch', {
        ...baseCtx,
        elapsedMs: Date.now() - start,
      });
      return {
        kind: 'reject',
        status: 403,
        reason: 'Session not owned by caller',
      };
    }
    emitSseBindOutcome('bound_ok', {
      ...baseCtx,
      elapsedMs: Date.now() - start,
    });
    return { kind: 'pass' };
  } catch {
    emitSseBindOutcome('redis_error', {
      ...baseCtx,
      elapsedMs: Date.now() - start,
    });
    // Fail closed: refuse rather than let the library dispatch based on an
    // unvalidated sessionId.
    return {
      kind: 'reject',
      status: 503,
      reason: 'Session verification unavailable',
    };
  }
}

/**
 * Pure decision for the SSE-owner-side envelope check. Returns true if the
 * tool/prompt invocation should be dropped because the caller's identity
 * (as carried through the Redis envelope in `extra.authInfo`) does not match
 * the identity captured when the SSE stream was established.
 */
export function shouldRejectEnvelope(
  sseOwnerIdentity: string | null,
  callerAuthInfo: AuthInfo | undefined,
): boolean {
  if (!sseOwnerIdentity) return false;
  const callerIdentity = deriveIdentity(callerAuthInfo);
  return callerIdentity !== sseOwnerIdentity;
}
