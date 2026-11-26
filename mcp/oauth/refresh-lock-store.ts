/**
 * Storage for the refresh-token lock in `refresh-lock.ts`.
 *
 * The store keeps one lock per refresh token (owner + TTL) and a short-lived
 * "transient upstream failure" marker. Every operation is a single atomic
 * statement, so the lock algorithm never has to reason about a half-applied
 * write.
 */

import { createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { logger } from '../utils/logger';

export type RefreshLockStore = {
  name: 'postgres';
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

// The token route has already queried this database before it takes the
// lock, so the compute is awake; a slower call falls back to running without
// the lock.
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
