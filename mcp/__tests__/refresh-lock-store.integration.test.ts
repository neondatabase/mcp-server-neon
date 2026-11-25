import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import type { AddressInfo, Socket } from 'node:net';
import { Predicate } from 'effect';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { neon } from '@neondatabase/serverless';
import { ensureOauthDatabaseUrl } from '../../e2e/provision-oauth-db';
import {
  createPostgresRefreshLockStore,
  createRedisRefreshLockStore,
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

  it('runs schema setup concurrently from several instances', async () => {
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

const DROP_AFTER_MS = 20;

// The keys, owners, and TTLs in these tests never start with `*` or `$`.
const commandsIn = (chunk: string): string[][] =>
  chunk.split('\r\n').reduce<string[][]>((commands, line) => {
    if (line.startsWith('*')) {
      commands.push([]);
    } else if (line !== '' && !line.startsWith('$')) {
      commands.at(-1)?.push(line);
    }

    return commands;
  }, []);

// A Redis stand-in that answers SET and GET or, during an outage, accepts
// every connection and drops it after DROP_AFTER_MS without replying.
const redisData = new Map<string, string>();
const redisSockets = new Set<Socket>();
const redisCounts = { accepted: 0, peakOpen: 0 };
const outage = { active: false };

const replyTo = ([command, key, value, ...options]: string[]): string => {
  const found = redisData.get(key);

  if (command === 'GET') {
    return found === undefined ? '$-1\r\n' : `$${found.length}\r\n${found}\r\n`;
  }

  if (options.includes('NX') && found !== undefined) {
    return '$-1\r\n';
  }

  redisData.set(key, value);

  return '+OK\r\n';
};

const dropSocket = (socket: Socket) => {
  redisSockets.delete(socket);
  socket.destroy();
};

const redisServer = createServer((socket) => {
  redisCounts.accepted += 1;
  redisSockets.add(socket);
  redisCounts.peakOpen = Math.max(redisCounts.peakOpen, redisSockets.size);
  socket.on('error', () => {
    dropSocket(socket);
  });
  socket.on('close', () => {
    redisSockets.delete(socket);
  });

  if (outage.active) {
    setTimeout(() => {
      dropSocket(socket);
    }, DROP_AFTER_MS);

    return;
  }

  socket.on('data', (chunk) => {
    for (const command of commandsIn(chunk.toString())) {
      socket.write(replyTo(command));
    }
  });
});

redisServer.listen(0, '127.0.0.1');

await once(redisServer, 'listening');

const redisAddress: AddressInfo | string | null = redisServer.address();

if (redisAddress === null || Predicate.isString(redisAddress)) {
  throw new Error('Redis stand-in has no TCP address');
}

const startOutage = () => {
  outage.active = true;

  for (const socket of redisSockets) {
    dropSocket(socket);
  }

  redisCounts.accepted = 0;
  redisCounts.peakOpen = 0;
};

const endOutage = async () => {
  outage.active = false;
  // Connections accepted during the outage are still dropped.
  await sleep(DROP_AFTER_MS * 2);
};

describe('Redis refresh lock store', () => {
  afterAll(() => {
    redisServer.close();
  });

  it('keeps one client through an outage and recovers on it', async () => {
    const s = createRedisRefreshLockStore(
      `redis://127.0.0.1:${redisAddress.port}`,
    );

    const rt = token();

    const failedAcquire = async () =>
      expect(s.tryAcquire(token(), 'owner-x', 6000)).rejects.toBeInstanceOf(
        Error,
      );

    // Four calls, one after another, during an outage.
    const failDuringOutage = async () => {
      startOutage();
      const startedAt = Date.now();
      await failedAcquire();
      await failedAcquire();
      await failedAcquire();
      await failedAcquire();
      await sleep(500);

      expect(redisCounts.peakOpen).toBe(1);
      expect(redisCounts.accepted).toBeLessThanOrEqual(
        (Date.now() - startedAt) / DROP_AFTER_MS + 2,
      );
      await endOutage();
    };

    await failDuringOutage();
    await expect(s.tryAcquire(rt, 'owner-a', 6000)).resolves.toBe(true);
    await expect(s.tryAcquire(rt, 'owner-b', 6000)).resolves.toBe(false);

    await failDuringOutage();
    await expect(s.isHeld(rt)).resolves.toBe(true);
    await expect(s.tryAcquire(rt, 'owner-b', 6000)).resolves.toBe(false);
    expect(redisSockets.size).toBe(1);
  });
});
