/**
 * Cross-instance distributed lock for refresh-token rotation.
 *
 * The cliff we're closing: two Vercel instances each receive a /api/token
 * request with the same refresh_token RT₁ within milliseconds, both forward
 * to upstream Hydra, and Hydra's reuse detector revokes the entire chain on
 * the second arrival. Same-instance races are already absorbed by the
 * in-memory `singleflight`; this module extends the same dedup property
 * across instances.
 *
 * The lock lives in Postgres (`OAUTH_DATABASE_URL`). While `KV_URL` is still
 * configured, the Redis lock is taken first and the Postgres lock inside it,
 * so deployments that only know the Redis lock keep coordinating with this
 * one during a rollover. Lock-acquire failures fall through to the
 * underlying executor: the only failure mode is "we don't get the
 * cross-instance dedup benefit," not "refresh breaks."
 */

import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger';
import {
  createPostgresRefreshLockStore,
  createRedisRefreshLockStore,
  type RefreshLockStore,
} from './refresh-lock-store';

// Short TTL so a vanished holder (Vercel function killed mid-flight by
// the platform — OOM, container shutdown, host eviction) doesn't keep
// waiters blocked for the previous 30s. The holder extends the TTL via a
// heartbeat while it's still alive (see `runWithHeartbeat`), so legitimate
// slow upstream calls don't get yanked. Sized at 2× HEARTBEAT_MS so one
// missed heartbeat (store blip, event-loop stall) doesn't expire the lock.
const LOCK_TTL_MS = 6_000;
const LOCK_HEARTBEAT_MS = 2_500;
const LOCK_POLL_INTERVAL_MS = 100;
// ~8s total waiter budget. Sized to cover the holder's upstream-call cap
// (UPSTREAM_REFRESH_TIMEOUT_MS in app/api/token/route.ts, ~4.5s) plus the
// holder's lock-release + transient-marker write, plus a margin for the
// waiter's own ~100ms poll granularity and store round-trips. With this
// budget the holder's atomic release + transient marker always lands first;
// the failure cache / marker then short-circuits the wait.
const LOCK_POLL_MAX_ATTEMPTS = 80;
// Cap total time a single waiter spends cycling through poll → takeover →
// poll. Prevents a takeover that itself vanishes from feeding the next
// waiter into another full poll loop.
const WAITER_TOTAL_BUDGET_MS = 8_000;

// Short — these are upstream 5xx-class errors that may recover. Long enough
// to absorb a wave of waiters, short enough that the next legitimate refresh
// attempt isn't masked.
const TRANSIENT_TTL_MS = 30_000;

let storesOverride: RefreshLockStore[] | undefined;
let cachedStores: RefreshLockStore[] | undefined;

function getStores(): RefreshLockStore[] {
  if (storesOverride) return storesOverride;
  if (cachedStores) return cachedStores;
  const stores: RefreshLockStore[] = [];
  const redisUrl = process.env.KV_URL || process.env.REDIS_URL;
  if (redisUrl) stores.push(createRedisRefreshLockStore(redisUrl));
  const databaseUrl = process.env.OAUTH_DATABASE_URL;
  if (databaseUrl) stores.push(createPostgresRefreshLockStore(databaseUrl));
  cachedStores = stores;
  return stores;
}

/**
 * Signal that the lock holder hit a transient (5xx-class) failure during the
 * upstream call. Concurrent waiters poll this marker and exit early instead
 * of waiting up to LOCK_POLL_MAX_ATTEMPTS × LOCK_POLL_INTERVAL_MS and
 * surfacing as 503 lock-timeout. Best-effort; failure to write is tolerable
 * because the worst-case is just the existing lock-wait timeout path.
 */
export async function signalTransientFailure(
  refreshToken: string,
): Promise<void> {
  await Promise.all(
    getStores().map(async (store) => {
      try {
        await store.markTransient(refreshToken, TRANSIENT_TTL_MS);
      } catch (err) {
        logger.warn('refresh-lock failed to signal transient failure', {
          store: store.name,
          err: err instanceof Error ? err.message : err,
        });
      }
    }),
  );
}

/**
 * Check whether a lock holder recently signalled a transient failure for
 * this refresh token in any store. Store errors count as "no marker" so
 * callers default to the normal poll loop instead of erroring out.
 */
export async function peekTransientFailure(
  refreshToken: string,
): Promise<boolean> {
  const seen = await Promise.all(
    getStores().map((store) =>
      store.hasTransient(refreshToken).catch(() => false),
    ),
  );
  return seen.some(Boolean);
}

const sleep = (ms: number) =>
  new Promise<void>((r) => {
    const t = setTimeout(r, ms);
    t.unref?.();
  });

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

/**
 * Runs `execute` while keeping the lock TTL refreshed via a heartbeat, then
 * releases the lock atomically — writing the transient marker in the same
 * operation when the hint asks for it.
 *
 * Heartbeat failures are non-fatal (logged). Two consecutive missed
 * heartbeats let the lock TTL out — the cost is one extra waiter promotion,
 * not a cliff (the takeover path in `runLocked` handles this).
 */
async function runWithHeartbeat<T>(
  store: RefreshLockStore,
  refreshToken: string,
  owner: string,
  hint: ReleaseHint,
  execute: () => Promise<T>,
): Promise<T> {
  const timer = setInterval(() => {
    store.extend(refreshToken, owner, LOCK_TTL_MS).catch((err) => {
      logger.warn('refresh-lock heartbeat failed', {
        store: store.name,
        err: err instanceof Error ? err.message : err,
      });
    });
  }, LOCK_HEARTBEAT_MS);
  timer.unref?.();
  try {
    return await execute();
  } finally {
    clearInterval(timer);
    const markTransient = hint.markTransientForWaiters === true;
    try {
      await store.release(
        refreshToken,
        owner,
        markTransient ? TRANSIENT_TTL_MS : undefined,
      );
    } catch (err) {
      // Lock will TTL out fast (LOCK_TTL_MS); failing release is non-fatal.
      logger.warn('refresh-lock release failed', {
        store: store.name,
        err: err instanceof Error ? err.message : err,
        markTransient,
      });
    }
  }
}

/**
 * Run `execute` while holding `store`'s lock on `refreshToken`. Other
 * instances calling concurrently with the same token will block on
 * `peekResult` until the holder either finishes (cache hit) or releases
 * (timeout / error fallthrough).
 *
 * - If we acquire the lock, we re-check `peekResult` once before running
 *   `execute` (a peer may have just finished and released).
 * - If we fail to acquire, we poll `peekResult` and the lock state. On a
 *   cache hit we return it; on the lock disappearing we take over once;
 *   otherwise we throw a 503-class error so the client retries (the
 *   failure cache will absorb any retry storm).
 * - If the store is unreachable, we log and run `execute` directly — we
 *   lose the cross-instance dedup but don't regress existing behavior.
 *
 * `peekResult` MUST be cheap and idempotent (it's called multiple times
 * during the wait loop).
 */
async function runLocked<T>(
  store: RefreshLockStore,
  refreshToken: string,
  hint: ReleaseHint,
  execute: () => Promise<T>,
  peekResult: () => Promise<T | undefined>,
): Promise<T> {
  const deadline = Date.now() + WAITER_TOTAL_BUDGET_MS;
  // Try to acquire the lock; if held, poll. On the first poll iteration where
  // we see the lock disappear without a cached result, attempt a takeover
  // (single retry — don't infinite-loop if the lock keeps getting grabbed-
  // and-vanished). Caps upstream calls at N+1 where N = number of vanished
  // holders observed, in practice always 1.
  let takeoverAttempted = false;

  while (Date.now() < deadline) {
    const owner = randomUUID();
    let acquired: boolean;
    try {
      acquired = await store.tryAcquire(refreshToken, owner, LOCK_TTL_MS);
    } catch (err) {
      logger.warn(
        'refresh-lock acquire failed, falling back to direct execute',
        {
          store: store.name,
          err: err instanceof Error ? err.message : err,
        },
      );
      return execute();
    }

    if (acquired) {
      return await runWithHeartbeat(
        store,
        refreshToken,
        owner,
        hint,
        async () => {
          // A peer may have just released after writing the cache and before
          // our acquire landed. This check runs inside the release-protected
          // path because a cached transient failure is reported by throwing.
          const fast = await peekResult();
          if (fast !== undefined) {
            return fast;
          }
          if (takeoverAttempted) {
            logger.info('refresh-lock waiter took over after holder vanished', {
              store: store.name,
            });
          }
          return execute();
        },
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
      let stillHeld: boolean;
      try {
        stillHeld = await store.isHeld(refreshToken);
      } catch {
        // Transient read failure → keep waiting on the cache instead of
        // stampeding upstream.
        continue;
      }
      if (!stillHeld) {
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
      // acquire. If we win, we run execute ourselves; if a peer beat us to
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

/**
 * Run `execute` while holding the cross-instance lock on `refreshToken` in
 * every configured store, outermost first. With no store configured (local
 * development), `execute` runs directly.
 */
export async function withRefreshLock<T>(
  refreshToken: string,
  execute: (hint: ReleaseHint) => Promise<T>,
  peekResult: () => Promise<T | undefined>,
): Promise<T> {
  const stores = getStores();
  const hint: ReleaseHint = {};
  if (stores.length === 0) {
    logger.warn(
      'refresh-lock unavailable (no KV_URL or OAUTH_DATABASE_URL), falling back to direct execute',
    );
    return execute(hint);
  }
  const run = stores.reduceRight<() => Promise<T>>(
    (inner, store) => () =>
      runLocked(store, refreshToken, hint, inner, peekResult),
    () => execute(hint),
  );
  return run();
}

/** Test seam for resetting module state. */
export function __resetForTests(): void {
  storesOverride = undefined;
  cachedStores = undefined;
}

/** Test seam for running the lock against specific stores. */
export function __setRefreshLockStoresForTests(
  stores: RefreshLockStore[],
): void {
  storesOverride = stores;
}
