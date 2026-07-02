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
// Short TTL so a vanished holder (Vercel function killed mid-flight by
// the platform — OOM, container shutdown, host eviction) doesn't keep
// waiters blocked for the previous 30s. The holder extends the TTL via a
// heartbeat while it's still alive (see `runWithHeartbeat`), so legitimate
// slow upstream calls don't get yanked. Sized at 2× HEARTBEAT_MS so one
// missed heartbeat (Redis blip, event-loop stall) doesn't expire the lock.
const LOCK_TTL_MS = 6_000;
const LOCK_HEARTBEAT_MS = 2_500;
const LOCK_POLL_INTERVAL_MS = 100;
// ~8s total waiter budget. Sized to cover the holder's upstream-call cap
// (UPSTREAM_REFRESH_TIMEOUT_MS in app/api/token/route.ts, ~4.5s) plus the
// holder's lock-release + transient-marker write, plus a margin for the
// waiter's own ~100ms poll granularity and Redis RTT. With this budget the
// holder's atomic Lua release + transient marker always lands first; the
// failure cache / marker then short-circuits the wait.
const LOCK_POLL_MAX_ATTEMPTS = 80;
// Cap total time a single waiter spends cycling through poll → takeover →
// poll. Prevents a takeover that itself vanishes from feeding the next
// waiter into another full poll loop.
const WAITER_TOTAL_BUDGET_MS = 8_000;
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

/**
 * Atomic compare-and-delete + transient-marker write. Used when the holder
 * exits via an upstream-5xx-class error: setting the marker and releasing the
 * lock in a single Redis round-trip closes the race where a waiter sees the
 * lock as released but the marker hasn't propagated yet (and falls through to
 * a `transient_lock_timeout` instead of bailing fast as `transient_upstream_5xx`).
 *
 * Production observation: during a Hydra 5xx burst at 2026-05-08 07:17 UTC,
 * 12/12 lock waiters hit their poll timeout despite the holder calling
 * `signalTransientFailure` before throwing. Two non-atomic SETs on Upstash HA
 * Redis can land on different replicas, so the waiter's `redis.get(lockKey)`
 * sees the release before its `redis.get(transientKey)` sees the marker.
 */
const RELEASE_WITH_TRANSIENT_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  redis.call("set", KEYS[2], ARGV[2], "PX", ARGV[3])
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/**
 * Atomic compare-and-extend (PEXPIRE only if owner matches). The heartbeat
 * uses this to extend the lock's TTL while the holder is alive, so a short
 * LOCK_TTL_MS doesn't yank legitimate slow upstream calls. If we no longer
 * own the lock (an extreme stall let it TTL-expire to a peer), we don't
 * extend it — the new owner is in charge.
 */
const HEARTBEAT_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
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
 * Runs `execute` while keeping the lock TTL refreshed via a heartbeat, then
 * releases the lock atomically — using either the plain release script or
 * the release-with-transient-marker script depending on the hint.
 *
 * Heartbeat failures are non-fatal (logged). Two consecutive missed
 * heartbeats let the lock TTL out — the cost is one extra waiter promotion,
 * not a cliff (the takeover path in `withRefreshLock` handles this).
 */
async function runWithHeartbeat<T>(
  redis: RedisClientType,
  refreshToken: string,
  owner: string,
  hint: ReleaseHint,
  execute: () => Promise<T>,
): Promise<T> {
  const lkey = lockKey(refreshToken);
  let timer: ReturnType<typeof setInterval> | undefined = setInterval(() => {
    // Fire-and-forget; failure means we missed a heartbeat.
    withTimeout(
      redis.eval(HEARTBEAT_LUA, {
        keys: [lkey],
        arguments: [owner, String(LOCK_TTL_MS)],
      }),
      'heartbeat',
    ).catch((err) => {
      logger.warn('refresh-lock heartbeat failed', {
        err: err instanceof Error ? err.message : err,
      });
    });
  }, LOCK_HEARTBEAT_MS);
  timer.unref?.();
  try {
    return await execute();
  } finally {
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
    try {
      if (hint.markTransientForWaiters) {
        await withTimeout(
          redis.eval(RELEASE_WITH_TRANSIENT_LUA, {
            keys: [lkey, transientKey(refreshToken)],
            arguments: [owner, '1', String(TRANSIENT_TTL_MS)],
          }),
          'release-with-transient',
        );
      } else {
        await withTimeout(
          redis.eval(RELEASE_LUA, { keys: [lkey], arguments: [owner] }),
          'release',
        );
      }
    } catch (err) {
      // Lock will TTL out fast (LOCK_TTL_MS); failing release is non-fatal.
      logger.warn('refresh-lock release failed', {
        err: err instanceof Error ? err.message : err,
        markTransient: hint.markTransientForWaiters === true,
      });
    }
  }
}

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
/**
 * Hint object passed to `execute` so the holder can request that the lock
 * release also writes the transient-failure marker atomically. Set
 * `markTransientForWaiters = true` when an upstream 5xx-class error is about
 * to throw — this is the race-free replacement for calling
 * `signalTransientFailure` separately.
 */
export type ReleaseHint = {
  markTransientForWaiters?: boolean;
};

export async function withRefreshLock<T>(
  refreshToken: string,
  execute: (hint: ReleaseHint) => Promise<T>,
  peekResult: () => Promise<T | undefined>,
): Promise<T> {
  let redis: RedisClientType;
  try {
    redis = await getRedis();
  } catch (err) {
    logger.warn('refresh-lock unavailable, falling back to direct execute', {
      err: err instanceof Error ? err.message : err,
    });
    // Fallback path: no lock, no waiters to signal. Hint discarded.
    return execute({});
  }

  const key = lockKey(refreshToken);
  const deadline = Date.now() + WAITER_TOTAL_BUDGET_MS;
  // Try to acquire the lock; if held, poll. On the first poll iteration where
  // we see the lock disappear without a cached result, attempt a takeover
  // (single retry — don't infinite-loop if the lock keeps getting grabbed-
  // and-vanished). Caps upstream calls at N+1 where N = number of vanished
  // holders observed, in practice always 1.
  let takeoverAttempted = false;

  while (Date.now() < deadline) {
    let acquired: string | null;
    const owner = randomUUID();
    try {
      acquired = await withTimeout(
        redis.set(key, owner, { NX: true, PX: LOCK_TTL_MS }),
        'set',
      );
    } catch (err) {
      logger.warn(
        'refresh-lock acquire failed, falling back to direct execute',
        { err: err instanceof Error ? err.message : err },
      );
      return execute({});
    }

    if (acquired === 'OK') {
      // A peer may have just released after writing the cache and before our
      // SET landed. Cheap to check; saves an upstream call when it hits.
      const fast = await peekResult();
      if (fast !== undefined) {
        // Best-effort release; we own a fresh lock no one is waiting on.
        try {
          await withTimeout(
            redis.eval(RELEASE_LUA, { keys: [key], arguments: [owner] }),
            'release',
          );
        } catch {
          /* TTLs out fast */
        }
        return fast;
      }
      if (takeoverAttempted) {
        // Useful in log aggregation: how often does the vanished-holder
        // pattern actually fire?
        logger.info('refresh-lock waiter took over after holder vanished');
      }
      const hint: ReleaseHint = {};
      // runWithHeartbeat keeps the short LOCK_TTL alive while execute runs,
      // and on completion releases via the appropriate Lua based on hint.
      return await runWithHeartbeat(redis, refreshToken, owner, hint, () =>
        execute(hint),
      );
    }

    // Another instance holds the lock. Poll for the result to materialize
    // or for the lock to disappear (signalling holder death).
    let lockDisappeared = false;
    for (let i = 0; i < LOCK_POLL_MAX_ATTEMPTS; i++) {
      if (Date.now() >= deadline) break;
      await sleep(LOCK_POLL_INTERVAL_MS);
      const cached = await peekResult();
      if (cached !== undefined) return cached;
      let stillHeld: string | null;
      try {
        stillHeld = await withTimeout(redis.get(key), 'get');
      } catch {
        // Transient get failure → keep waiting on the cache instead of
        // stampeding upstream.
        continue;
      }
      if (stillHeld === null) {
        // Holder released (or vanished — heartbeat stopped firing and the
        // short TTL expired). They may have just written the cache between
        // our peek above and this check, so one final peek closes the race.
        const finalPeek = await peekResult();
        if (finalPeek !== undefined) return finalPeek;
        lockDisappeared = true;
        break;
      }
    }

    if (lockDisappeared && !takeoverAttempted) {
      // Vanished-holder takeover: re-enter the outer loop to attempt a fresh
      // SET NX. If we win, we run execute ourselves; if a peer beat us to
      // it, we fall back into the poll loop against the new owner.
      takeoverAttempted = true;
      continue;
    }
    break;
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
