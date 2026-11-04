import { createHash, randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { neon } from '@neondatabase/serverless';
import { ensureOauthDatabaseUrl } from '../../e2e/provision-oauth-db';
import {
  createPostgresRefreshLockStore,
  ensureRefreshLockSchema,
  type RefreshLockStore,
} from '../oauth/refresh-lock-store';

let url: string;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const token = () => `rt-${randomUUID()}`;
const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

function store(): RefreshLockStore {
  return createPostgresRefreshLockStore(url);
}

beforeAll(async () => {
  url = await ensureOauthDatabaseUrl();
  // Production takes the lock after the token route has already queried this
  // database, so the compute is awake and the schema exists.
  await ensureRefreshLockSchema(url);
});

describe('Postgres refresh lock store', () => {
  it('lets exactly one of two instances acquire a free lock', async () => {
    const rt = token();
    const [a, b] = [store(), store()];
    const results = await Promise.all([
      a.tryAcquire(rt, 'owner-a', 6_000),
      b.tryAcquire(rt, 'owner-b', 6_000),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await a.isHeld(rt)).toBe(true);
  });

  it('refuses a live lock and takes over an expired one', async () => {
    const rt = token();
    const s = store();
    expect(await s.tryAcquire(rt, 'owner-a', 1_500)).toBe(true);
    expect(await s.tryAcquire(rt, 'owner-b', 6_000)).toBe(false);
    await sleep(1_700);
    expect(await s.isHeld(rt)).toBe(false);
    expect(await s.tryAcquire(rt, 'owner-b', 6_000)).toBe(true);
  });

  it('releases and extends only for the owner', async () => {
    const rt = token();
    const s = store();
    expect(await s.tryAcquire(rt, 'owner-a', 1_500)).toBe(true);
    await s.release(rt, 'owner-b');
    expect(await s.isHeld(rt)).toBe(true);
    await s.extend(rt, 'owner-b', 6_000);
    await sleep(1_700);
    expect(await s.isHeld(rt)).toBe(false);

    expect(await s.tryAcquire(rt, 'owner-c', 1_500)).toBe(true);
    await s.extend(rt, 'owner-c', 6_000);
    await sleep(1_700);
    expect(await s.isHeld(rt)).toBe(true);
    await s.release(rt, 'owner-c');
    expect(await s.isHeld(rt)).toBe(false);
  });

  it('does not revive an expired lock that cleanup has not removed yet', async () => {
    const rt = token();
    const s = store();
    expect(await s.tryAcquire(rt, 'owner-a', 200)).toBe(true);
    await sleep(300);
    await s.extend(rt, 'owner-a', 6_000);
    expect(await s.isHeld(rt)).toBe(false);
    expect(await s.tryAcquire(rt, 'owner-b', 6_000)).toBe(true);
  });

  it('writes the transient marker in the same statement as a successful release', async () => {
    const rt = token();
    const s = store();
    expect(await s.tryAcquire(rt, 'owner-a', 6_000)).toBe(true);
    expect(await s.hasTransient(rt)).toBe(false);
    await s.release(rt, 'owner-a', 30_000);
    expect(await s.isHeld(rt)).toBe(false);
    expect(await s.hasTransient(rt)).toBe(true);
  });

  it('writes no transient marker for a holder whose lock already expired', async () => {
    const rt = token();
    const s = store();
    expect(await s.tryAcquire(rt, 'owner-a', 200)).toBe(true);
    await sleep(300);
    await s.release(rt, 'owner-a', 30_000);
    expect(await s.hasTransient(rt)).toBe(false);

    expect(await s.tryAcquire(rt, 'owner-b', 6_000)).toBe(true);
    await s.release(rt, 'owner-a', 30_000);
    expect(await s.isHeld(rt)).toBe(true);
    expect(await s.hasTransient(rt)).toBe(false);
  });

  it('expires the transient marker', async () => {
    const rt = token();
    const s = store();
    await s.markTransient(rt, 200);
    expect(await s.hasTransient(rt)).toBe(true);
    await sleep(300);
    expect(await s.hasTransient(rt)).toBe(false);
  });

  it('stores a hash of the refresh token, never the token itself', async () => {
    const rt = token();
    const s = store();
    await s.tryAcquire(rt, 'owner-a', 6_000);
    await s.markTransient(rt, 30_000);
    const sql = neon(url);
    const raw = await sql`
      SELECT key FROM mcpauth.refresh_locks WHERE key = ${rt}
      UNION ALL
      SELECT key FROM mcpauth.refresh_transient WHERE key = ${rt}
    `;
    expect(raw).toHaveLength(0);
    const hashed = await sql`
      SELECT key FROM mcpauth.refresh_locks WHERE key = ${sha256(rt)}
      UNION ALL
      SELECT key FROM mcpauth.refresh_transient WHERE key = ${sha256(rt)}
    `;
    expect(hashed).toHaveLength(2);
  });

  it('creates the schema safely from concurrent first calls', async () => {
    const graphs = await Promise.all(
      [0, 1, 2].map(async () => {
        vi.resetModules();
        return import('../oauth/refresh-lock-store');
      }),
    );
    await expect(
      Promise.all(graphs.map((m) => m.ensureRefreshLockSchema(url))),
    ).resolves.toHaveLength(3);
  });
});
