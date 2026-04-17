import { createHash, timingSafeEqual } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { AuthContext } from '../types/auth';
import { logger } from '../utils/logger';

const SESSION_KEY_PREFIX = 'mcp:session:';

let clientPromise: Promise<RedisClientType> | null = null;

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
 * (account, bearer-token) pair so that a POST from a different account — or
 * the same account presenting a different token — cannot inject into this
 * SSE stream even if the sessionId leaks.
 */
export function deriveIdentity(authInfo: AuthInfo | undefined): string | null {
  const extra = authInfo?.extra as AuthContext['extra'] | undefined;
  const accountId = extra?.account?.id;
  const apiKey = extra?.apiKey;
  if (!accountId || typeof apiKey !== 'string') return null;
  return createHash('sha256')
    .update(`${accountId}:${apiKey}`)
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
  const redis = await getRedis();
  await redis.set(sessionKey(sessionId), identity, { EX: ttlSec });
}

export async function verifySession(
  sessionId: string,
  identity: string,
): Promise<boolean> {
  const redis = await getRedis();
  const stored = await redis.get(sessionKey(sessionId));
  if (!stored) return false;
  const a = Buffer.from(stored);
  const b = Buffer.from(identity);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function releaseSession(sessionId: string): Promise<void> {
  const redis = await getRedis();
  await redis.del(sessionKey(sessionId));
}

export type MessageOwnershipResult =
  | { kind: 'pass' }
  | { kind: 'not-applicable' }
  | { kind: 'reject'; status: 401 | 403 | 503; reason: string };

/**
 * Pure decision for whether a POST to the SSE message endpoint is allowed to
 * proceed. Returns `pass` only when the caller's identity matches the binding
 * stored under the provided sessionId. Extracted from the route handler so
 * it can be exercised without spinning up the MCP handler.
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
  if (!identity) {
    return {
      kind: 'reject',
      status: 401,
      reason: 'Caller identity unavailable',
    };
  }
  try {
    const ok = await verifySession(sessionId, identity);
    if (!ok) {
      return {
        kind: 'reject',
        status: 403,
        reason: 'Session not owned by caller',
      };
    }
    return { kind: 'pass' };
  } catch {
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
