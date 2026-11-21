/**
 * Cross-instance distributed lock for refresh-token rotation: the stores and
 * their timings. `RefreshLock` in `refresh-lock-service.ts` runs the lock.
 *
 * The cliff we're closing: two Vercel instances each receive a /api/token
 * request with the same refresh_token RT₁ within milliseconds, both forward
 * to upstream Hydra, and Hydra's reuse detector revokes the entire chain on
 * the second arrival. Same-instance races are already absorbed by
 * `RefreshInflight`; this lock extends the same dedup property across
 * instances.
 *
 * The lock lives in Postgres (`OAUTH_DATABASE_URL`). While `KV_URL` is still
 * configured, the Redis lock is taken first and the Postgres lock inside it,
 * so deployments that only know the Redis lock keep coordinating with this
 * one during a rollover. Lock-acquire failures fall through to the
 * underlying executor: the only failure mode is "we don't get the
 * cross-instance dedup benefit," not "refresh breaks."
 */

import { logger } from '../utils/logger';
import {
  createPostgresRefreshLockStore,
  createRedisRefreshLockStore,
  type RefreshLockStore,
} from './refresh-lock-store';

// Short TTL so a vanished holder (Vercel function killed mid-flight by
// the platform — OOM, container shutdown, host eviction) doesn't keep
// waiters blocked for the previous 30s. The holder extends the TTL via a
// heartbeat while it's still alive, so legitimate slow upstream calls don't
// get yanked. Sized at 2× HEARTBEAT_MS so one missed heartbeat (store blip,
// event-loop stall) doesn't expire the lock.
export const LOCK_TTL_MS = 6_000;
export const LOCK_HEARTBEAT_MS = 2_500;
export const LOCK_POLL_INTERVAL_MS = 100;
// ~8s total waiter budget. Sized to cover the holder's upstream-call cap
// (UPSTREAM_REFRESH_TIMEOUT_MS in mcp/oauth/upstream-refresh.ts, ~4.5s) plus
// the holder's lock-release + transient-marker write, plus a margin for the
// waiter's own ~100ms poll granularity and store round-trips. With this
// budget the holder's atomic release + transient marker always lands first;
// the failure cache / marker then short-circuits the wait.
export const LOCK_POLL_MAX_ATTEMPTS = 80;
// Cap total time a single waiter spends cycling through poll → takeover →
// poll. Prevents a takeover that itself vanishes from feeding the next
// waiter into another full poll loop.
export const WAITER_TOTAL_BUDGET_MS = 8_000;

// Short — these are upstream 5xx-class errors that may recover. Long enough
// to absorb a wave of waiters, short enough that the next legitimate refresh
// attempt isn't masked.
export const TRANSIENT_TTL_MS = 30_000;

let storesOverride: RefreshLockStore[] | undefined;
let cachedStores: RefreshLockStore[] | undefined;

/** The configured lock stores, outermost first; none in local development. */
export function refreshLockStores(): RefreshLockStore[] {
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
    refreshLockStores().map(async (store) => {
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
    refreshLockStores().map((store) =>
      store.hasTransient(refreshToken).catch(() => false),
    ),
  );
  return seen.some(Boolean);
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
