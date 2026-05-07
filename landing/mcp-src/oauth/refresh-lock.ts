/**
 * Cross-instance distributed lock for refresh-token rotation.
 *
 * The cliff we're closing: two Vercel instances each receive a /api/token
 * request with the same refresh_token RT₁ within milliseconds, both forward
 * to upstream Hydra, and Hydra's reuse detector revokes the entire chain on
 * the second arrival. Same-instance races are already absorbed by the
 * in-memory `singleflight`; this module extends the same dedup property
 * across instances using Upstash Redis.
 *
 * Pattern: SET NX PX <ttl> with a random owner token; release is gated by
 * Lua to avoid cross-instance lock-stealing after a TTL expiry. Lock-acquire
 * failures fall through to the underlying executor — preserves the
 * pre-lock behaviour if Redis is unavailable, so the only failure mode is
 * "we don't get the cross-instance dedup benefit," not "refresh breaks."
 */

import { randomUUID } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import { logger } from '../utils/logger';

const LOCK_KEY_PREFIX = 'mcp:refresh-lock:';
const LOCK_TTL_MS = 30_000;
const LOCK_POLL_INTERVAL_MS = 100;
const LOCK_POLL_MAX_ATTEMPTS = 50; // ~5s total wait
const REDIS_OP_TIMEOUT_MS = 500;

const TRANSIENT_KEY_PREFIX = 'mcp:refresh-transient:';
// Short — these are upstream 5xx-class errors that may recover. Long enough
// to absorb a wave of waiters, short enough that the next legitimate refresh
// attempt isn't masked.
const TRANSIENT_TTL_MS = 30_000;

let clientPromise: Promise<RedisClientType> | null = null;

function withTimeout<T>(promise: Promise<T>, op: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`refresh-lock ${op} timed out`));
    }, REDIS_OP_TIMEOUT_MS);
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

function getRedis(): Promise<RedisClientType> {
  if (clientPromise) return clientPromise;
  const url = process.env.KV_URL || process.env.REDIS_URL;
  if (!url) {
    return Promise.reject(
      new Error('KV_URL/REDIS_URL not set; refresh lock unavailable'),
    );
  }
  const client = createClient({ url }) as RedisClientType;
  client.on('error', (err) => {
    logger.error('refresh-lock redis error', { err });
    clientPromise = null;
  });
  const pending = client.connect().then(() => client);
  pending.catch(() => {
    clientPromise = null;
  });
  clientPromise = pending;
  return clientPromise;
}

function lockKey(refreshToken: string): string {
  return `${LOCK_KEY_PREFIX}${refreshToken}`;
}

function transientKey(refreshToken: string): string {
  return `${TRANSIENT_KEY_PREFIX}${refreshToken}`;
}

/**
 * Signal that the lock holder hit a transient (5xx-class) failure during the
 * upstream call. Concurrent waiters poll this marker and exit early instead
 * of waiting up to LOCK_POLL_MAX_ATTEMPTS × LOCK_POLL_INTERVAL_MS ≈ 5s and
 * surfacing as 503 lock-timeout. Best-effort; failure to write is tolerable
 * because the worst-case is just the existing lock-wait timeout path.
 */
export async function signalTransientFailure(
  refreshToken: string,
): Promise<void> {
  try {
    const redis = await getRedis();
    await withTimeout(
      redis.set(transientKey(refreshToken), '1', { PX: TRANSIENT_TTL_MS }),
      'set-transient',
    );
  } catch (err) {
    logger.warn('refresh-lock failed to signal transient failure', {
      err: err instanceof Error ? err.message : err,
    });
  }
}

/**
 * Check whether the lock holder recently signalled a transient failure for
 * this refresh token. Returns false on any Redis error so callers default
 * to the normal poll loop instead of erroring out.
 */
export async function peekTransientFailure(
  refreshToken: string,
): Promise<boolean> {
  try {
    const redis = await getRedis();
    const v = await withTimeout(
      redis.get(transientKey(refreshToken)),
      'get-transient',
    );
    return v !== null;
  } catch {
    return false;
  }
}

/** Atomic compare-and-delete so a slow holder can't release a TTL-replaced lock. */
const RELEASE_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

const sleep = (ms: number) =>
  new Promise<void>((r) => {
    const t = setTimeout(r, ms);
    t.unref?.();
  });

/**
 * Run `execute` while holding a cross-instance lock on `refreshToken`. Other
 * instances calling concurrently with the same token will block on
 * `peekResult` until the holder either finishes (cache hit) or releases
 * (timeout / error fallthrough).
 *
 * - If we acquire the lock, we re-check `peekResult` once before running
 *   `execute` (a peer may have just finished and released).
 * - If we fail to acquire, we poll `peekResult` and the lock state for ~5s.
 *   On a cache hit we return it; on the lock disappearing we throw a
 *   503-class error so the client retries (the failure cache will absorb
 *   any retry storm).
 * - If Redis is unreachable, we log and run `execute` directly — we lose
 *   the cross-instance dedup but don't regress existing behavior.
 *
 * `peekResult` MUST be cheap and idempotent (it's called multiple times
 * during the wait loop).
 */
export async function withRefreshLock<T>(
  refreshToken: string,
  execute: () => Promise<T>,
  peekResult: () => Promise<T | undefined>,
): Promise<T> {
  let redis: RedisClientType;
  try {
    redis = await getRedis();
  } catch (err) {
    logger.warn('refresh-lock unavailable, falling back to direct execute', {
      err: err instanceof Error ? err.message : err,
    });
    return execute();
  }

  const key = lockKey(refreshToken);
  const owner = randomUUID();

  let acquired: string | null;
  try {
    acquired = await withTimeout(
      redis.set(key, owner, { NX: true, PX: LOCK_TTL_MS }),
      'set',
    );
  } catch (err) {
    logger.warn('refresh-lock acquire failed, falling back to direct execute', {
      err: err instanceof Error ? err.message : err,
    });
    return execute();
  }

  if (acquired === 'OK') {
    try {
      // A peer may have just released after writing the cache and before our
      // SET landed. Cheap to check; saves an upstream call when it hits.
      const fast = await peekResult();
      if (fast !== undefined) return fast;
      return await execute();
    } finally {
      try {
        await withTimeout(
          redis.eval(RELEASE_LUA, { keys: [key], arguments: [owner] }),
          'release',
        );
      } catch (err) {
        // Lock will TTL out; failing release is non-fatal.
        logger.warn('refresh-lock release failed', {
          err: err instanceof Error ? err.message : err,
        });
      }
    }
  }

  // Another instance holds the lock. Wait for the result to materialize.
  for (let i = 0; i < LOCK_POLL_MAX_ATTEMPTS; i++) {
    await sleep(LOCK_POLL_INTERVAL_MS);
    const cached = await peekResult();
    if (cached !== undefined) return cached;
    let stillHeld: string | null;
    try {
      stillHeld = await withTimeout(redis.get(key), 'get');
    } catch {
      // Treat transient get failure as "still held" so we keep waiting on
      // the cache instead of stampeding upstream.
      continue;
    }
    if (stillHeld === null) {
      // Holder released. They may have just written the cache or
      // failure cache between our peek above and this check (the order
      // is "peek then redis.get", so a holder finishing in that micro-
      // window is invisible to the iteration's peek). One final peek
      // before bailing closes the race; production showed ~1/hour
      // false-503s from this exact scheduling pattern.
      const finalPeek = await peekResult();
      if (finalPeek !== undefined) return finalPeek;
      break;
    }
  }

  // We waited long enough and never saw a result. Surface a transient error
  // so the client retries — by then either the cache is populated (success
  // path) or the failure cache is populated (4xx path).
  const err: Error & { status?: number; oauth_error?: string } = new Error(
    'Concurrent refresh in progress',
  );
  err.status = 503;
  err.oauth_error = 'temporarily_unavailable';
  throw err;
}

/** Test seam for resetting module state. */
export function __resetForTests(): void {
  clientPromise = null;
}
