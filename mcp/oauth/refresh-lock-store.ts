/**
 * Storage backends for the refresh-token lock in `refresh-lock.ts`.
 *
 * Each store keeps one lock per refresh token (owner + TTL) and a short-lived
 * "transient upstream failure" marker. Every operation is a single atomic
 * command or statement, so the lock algorithm never has to reason about a
 * half-applied write.
 */

import { createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { createClient, type RedisClientType } from 'redis';
import { logger } from '../utils/logger';

export type RefreshLockStore = {
  name: 'redis' | 'postgres';
  /** Take the lock if it is free or expired. Resolves true when we own it. */
  tryAcquire: (
    refreshToken: string,
    owner: string,
    ttlMs: number,
  ) => Promise<boolean>;
  /** True while any owner holds an unexpired lock. */
  isHeld: (refreshToken: string) => Promise<boolean>;
  /** Extend the TTL, only while `owner` still holds an unexpired lock. */
  extend: (refreshToken: string, owner: string, ttlMs: number) => Promise<void>;
  /**
   * Release the lock if `owner` holds it. With `transientTtlMs`, the
   * transient marker is written in the same atomic operation, and only when
   * the release succeeded.
   */
  release: (
    refreshToken: string,
    owner: string,
    transientTtlMs?: number,
  ) => Promise<void>;
  markTransient: (refreshToken: string, ttlMs: number) => Promise<void>;
  hasTransient: (refreshToken: string) => Promise<boolean>;
};

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  op: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`refresh-lock ${op} timed out`));
    }, timeoutMs);
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

// ─────────────────────────────────────────────────────────────────────────
// Redis (Upstash via Vercel KV)
// ─────────────────────────────────────────────────────────────────────────

// Deployments from before the Postgres lock use these exact keys, so they
// must not change while any such deployment can still serve /api/token.
const REDIS_LOCK_KEY_PREFIX = 'mcp:refresh-lock:';
const REDIS_TRANSIENT_KEY_PREFIX = 'mcp:refresh-transient:';
const REDIS_OP_TIMEOUT_MS = 500;

/** Atomic compare-and-delete so a slow holder can't release a TTL-replaced lock. */
const RELEASE_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/**
 * Compare-and-delete plus transient-marker write in one round-trip. Two
 * separate SETs on Upstash HA Redis can land on different replicas, so a
 * waiter could see the release before the marker (the 2026-05-08 07:17 UTC
 * Hydra burst: 12/12 waiters timed out instead of bailing fast).
 */
const RELEASE_WITH_TRANSIENT_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  redis.call("set", KEYS[2], ARGV[2], "PX", ARGV[3])
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/** Compare-and-extend: only the current owner may push the TTL out. */
const HEARTBEAT_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
else
  return 0
end
`;

export function createRedisRefreshLockStore(url: string): RefreshLockStore {
  let clientPromise: Promise<RedisClientType> | null = null;

  const getClient = (): Promise<RedisClientType> => {
    if (clientPromise) return clientPromise;
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
  };

  const run = async <T>(
    op: string,
    fn: (redis: RedisClientType) => Promise<T>,
  ): Promise<T> => {
    const redis = await getClient();
    return withTimeout(fn(redis), REDIS_OP_TIMEOUT_MS, op);
  };

  const lockKey = (refreshToken: string) =>
    `${REDIS_LOCK_KEY_PREFIX}${refreshToken}`;
  const transientKey = (refreshToken: string) =>
    `${REDIS_TRANSIENT_KEY_PREFIX}${refreshToken}`;

  return {
    name: 'redis',
    tryAcquire: async (refreshToken, owner, ttlMs) => {
      const result = await run('set', (redis) =>
        redis.set(lockKey(refreshToken), owner, { NX: true, PX: ttlMs }),
      );
      return result === 'OK';
    },
    isHeld: async (refreshToken) => {
      const holder = await run('get', (redis) =>
        redis.get(lockKey(refreshToken)),
      );
      return holder !== null;
    },
    extend: async (refreshToken, owner, ttlMs) => {
      await run('heartbeat', (redis) =>
        redis.eval(HEARTBEAT_LUA, {
          keys: [lockKey(refreshToken)],
          arguments: [owner, String(ttlMs)],
        }),
      );
    },
    release: async (refreshToken, owner, transientTtlMs) => {
      if (transientTtlMs !== undefined) {
        await run('release-with-transient', (redis) =>
          redis.eval(RELEASE_WITH_TRANSIENT_LUA, {
            keys: [lockKey(refreshToken), transientKey(refreshToken)],
            arguments: [owner, '1', String(transientTtlMs)],
          }),
        );
        return;
      }
      await run('release', (redis) =>
        redis.eval(RELEASE_LUA, {
          keys: [lockKey(refreshToken)],
          arguments: [owner],
        }),
      );
    },
    markTransient: async (refreshToken, ttlMs) => {
      await run('set-transient', (redis) =>
        redis.set(transientKey(refreshToken), '1', { PX: ttlMs }),
      );
    },
    hasTransient: async (refreshToken) => {
      const value = await run('get-transient', (redis) =>
        redis.get(transientKey(refreshToken)),
      );
      return value !== null;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Postgres (OAUTH_DATABASE_URL)
// ─────────────────────────────────────────────────────────────────────────

// An HTTP query has a higher floor than a Redis command. The token route has
// already queried this database before it takes the lock, so the compute is
// awake; a slower call falls back exactly like an unreachable Redis did.
const POSTGRES_OP_TIMEOUT_MS = 1_500;
const CLEANUP_INTERVAL_MS = 10 * 60_000;
// Distinct from the auth-transaction schema lock (872334901).
const SCHEMA_ADVISORY_LOCK_ID = 872334902;

// A lock row outlives a holder that dies mid-refresh, so the refresh token
// itself is never stored.
function hashKey(refreshToken: string): string {
  return createHash('sha256').update(refreshToken).digest('hex');
}

const schemaReady = new Map<string, Promise<void>>();

async function createSchema(connectionString: string): Promise<void> {
  const sql = neon(connectionString);
  await sql.transaction([
    sql`SELECT pg_advisory_xact_lock(${SCHEMA_ADVISORY_LOCK_ID})`,
    sql`CREATE SCHEMA IF NOT EXISTS mcpauth`,
    sql`
      CREATE TABLE IF NOT EXISTS mcpauth.refresh_locks (
        key TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      )
    `,
    sql`
      CREATE TABLE IF NOT EXISTS mcpauth.refresh_transient (
        key TEXT PRIMARY KEY,
        expires_at TIMESTAMPTZ NOT NULL
      )
    `,
  ]);
}

export async function ensureRefreshLockSchema(
  connectionString: string,
): Promise<void> {
  let ready = schemaReady.get(connectionString);
  if (!ready) {
    ready = createSchema(connectionString);
    schemaReady.set(connectionString, ready);
  }
  try {
    await ready;
  } catch (err) {
    schemaReady.delete(connectionString);
    throw err;
  }
}

export function createPostgresRefreshLockStore(
  connectionString: string,
): RefreshLockStore {
  const sql = neon(connectionString);
  let lastCleanupAt = 0;

  const run = async <T>(op: string, fn: () => Promise<T>): Promise<T> =>
    withTimeout(
      ensureRefreshLockSchema(connectionString).then(fn),
      POSTGRES_OP_TIMEOUT_MS,
      op,
    );

  const cleanupExpired = () => {
    const now = Date.now();
    if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
    lastCleanupAt = now;
    sql
      .transaction([
        sql`DELETE FROM mcpauth.refresh_locks WHERE expires_at <= now()`,
        sql`DELETE FROM mcpauth.refresh_transient WHERE expires_at <= now()`,
      ])
      .catch((err: unknown) => {
        logger.warn('refresh-lock cleanup failed', {
          err: err instanceof Error ? err.message : err,
        });
      });
  };

  return {
    name: 'postgres',
    tryAcquire: async (refreshToken, owner, ttlMs) => {
      const rows = await run(
        'acquire',
        () => sql`
          INSERT INTO mcpauth.refresh_locks (key, owner, expires_at)
          VALUES (
            ${hashKey(refreshToken)},
            ${owner},
            now() + ${ttlMs} * interval '1 millisecond'
          )
          ON CONFLICT (key) DO UPDATE
          SET owner = EXCLUDED.owner, expires_at = EXCLUDED.expires_at
          WHERE mcpauth.refresh_locks.expires_at <= now()
          RETURNING owner
        `,
      );
      const acquired = rows.length === 1 && rows[0].owner === owner;
      if (acquired) cleanupExpired();
      return acquired;
    },
    isHeld: async (refreshToken) => {
      const rows = await run(
        'get',
        () => sql`
          SELECT 1 FROM mcpauth.refresh_locks
          WHERE key = ${hashKey(refreshToken)} AND expires_at > now()
        `,
      );
      return rows.length > 0;
    },
    extend: async (refreshToken, owner, ttlMs) => {
      await run(
        'heartbeat',
        () => sql`
          UPDATE mcpauth.refresh_locks
          SET expires_at = now() + ${ttlMs} * interval '1 millisecond'
          WHERE key = ${hashKey(refreshToken)}
            AND owner = ${owner}
            AND expires_at > now()
        `,
      );
    },
    release: async (refreshToken, owner, transientTtlMs) => {
      const key = hashKey(refreshToken);
      if (transientTtlMs !== undefined) {
        await run(
          'release-with-transient',
          () => sql`
            WITH released AS (
              DELETE FROM mcpauth.refresh_locks
              WHERE key = ${key} AND owner = ${owner} AND expires_at > now()
              RETURNING key
            )
            INSERT INTO mcpauth.refresh_transient (key, expires_at)
            SELECT key, now() + ${transientTtlMs} * interval '1 millisecond'
            FROM released
            ON CONFLICT (key) DO UPDATE SET expires_at = EXCLUDED.expires_at
          `,
        );
        return;
      }
      await run(
        'release',
        () => sql`
          DELETE FROM mcpauth.refresh_locks
          WHERE key = ${key} AND owner = ${owner}
        `,
      );
    },
    markTransient: async (refreshToken, ttlMs) => {
      await run(
        'set-transient',
        () => sql`
          INSERT INTO mcpauth.refresh_transient (key, expires_at)
          VALUES (
            ${hashKey(refreshToken)},
            now() + ${ttlMs} * interval '1 millisecond'
          )
          ON CONFLICT (key) DO UPDATE SET expires_at = EXCLUDED.expires_at
        `,
      );
    },
    hasTransient: async (refreshToken) => {
      const rows = await run(
        'get-transient',
        () => sql`
          SELECT 1 FROM mcpauth.refresh_transient
          WHERE key = ${hashKey(refreshToken)} AND expires_at > now()
        `,
      );
      return rows.length > 0;
    },
  };
}
