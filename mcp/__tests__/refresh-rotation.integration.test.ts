/**
 * Refresh-token rotation across independently loaded /api/token instances
 * that share the real OAuth Postgres database (tokens, refresh result cache,
 * failure cache and the Postgres lock) and one Redis.
 *
 * The rollout this covers:
 *   - "redis" instances: deployments from before the Postgres lock
 *   - "both" instances: this change while KV_URL is still set
 *   - "postgres" instances: after Redis is removed
 * Instances from adjacent phases run side by side during a Vercel rollover,
 * so each adjacent pair must still forward every refresh token upstream
 * exactly once.
 *
 * The upstream stand-in records refresh-token reuse, which is what makes
 * Hydra revoke a user's whole token chain.
 */

import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureTestOauthDatabase } from './ensure-test-oauth-database';

type RedisEntry = { value: string; expiresAt?: number };

const shared = {
  redis: new Map<string, RedisEntry>(),
  upstreamCalls: 0,
  upstreamLatencyMs: 300,
  presented: new Set<string>(),
  reuse: [] as string[],
};

function liveRedisEntry(key: string): RedisEntry | undefined {
  const entry = shared.redis.get(key);
  if (entry?.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
    shared.redis.delete(key);
    return undefined;
  }
  return entry;
}

// One Redis for every instance. Each call runs synchronously to completion,
// matching Redis's single-command atomicity; the three Lua scripts in
// refresh-lock-store.ts are told apart by their bodies.
vi.mock('redis', () => ({
  createClient: () => ({
    on: () => undefined,
    connect: async () => undefined,
    set: async (
      key: string,
      value: string,
      opts?: { NX?: boolean; PX?: number },
    ) => {
      if (opts?.NX && liveRedisEntry(key)) return null;
      shared.redis.set(key, {
        value,
        expiresAt: opts?.PX ? Date.now() + opts.PX : undefined,
      });
      return 'OK';
    },
    get: async (key: string) => liveRedisEntry(key)?.value ?? null,
    eval: async (
      script: string,
      opts: { keys: string[]; arguments: string[] },
    ) => {
      const [lockKey, transientKey] = opts.keys;
      const [owner, ...rest] = opts.arguments;
      if (liveRedisEntry(lockKey)?.value !== owner) return 0;
      if (script.includes('pexpire')) {
        shared.redis.set(lockKey, {
          value: owner,
          expiresAt: Date.now() + Number(rest[0]),
        });
        return 1;
      }
      if (transientKey) {
        shared.redis.set(transientKey, {
          value: rest[0],
          expiresAt: Date.now() + Number(rest[1]),
        });
      }
      shared.redis.delete(lockKey);
      return 1;
    },
  }),
}));

vi.mock('../../lib/oauth/client', () => ({
  exchangeRefreshToken: async (refreshToken: string) => {
    shared.upstreamCalls++;
    if (shared.presented.has(refreshToken)) shared.reuse.push(refreshToken);
    shared.presented.add(refreshToken);
    await new Promise((r) => setTimeout(r, shared.upstreamLatencyMs));
    const issuance = shared.upstreamCalls;
    return {
      access_token: `at-${randomUUID()}-${issuance}`,
      refresh_token: `rt-${randomUUID()}-${issuance}`,
      expiresIn: () => 3600,
      scope: 'read write',
    };
  },
}));

vi.mock('../analytics/analytics', () => ({
  identify: vi.fn(),
  flushAnalytics: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@vercel/functions', () => ({
  waitUntil: vi.fn(),
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type Phase = 'redis' | 'both' | 'postgres';
type Instance = {
  phase: Phase;
  POST: (request: NextRequest) => Promise<Response>;
};

const CLIENT = {
  id: 'refresh-rotation-client',
  secret: 'refresh-rotation-secret',
  grants: ['authorization_code', 'refresh_token'],
  redirect_uris: ['http://localhost/callback'],
  client_name: 'Refresh rotation test',
  tokenEndpointAuthMethod: 'client_secret_post',
};

let databaseUrl: string;

// A fresh module graph per instance: its own singleflight, its own lock
// store clients, its own Keyv pools. Only the databases are shared.
async function startInstance(phase: Phase): Promise<Instance> {
  vi.resetModules();
  const lock = await import('../oauth/refresh-lock');
  const stores = await import('../oauth/refresh-lock-store');
  const redis = stores.createRedisRefreshLockStore('redis://test');
  const postgres = stores.createPostgresRefreshLockStore(databaseUrl);
  lock.__setRefreshLockStoresForTests(
    phase === 'redis'
      ? [redis]
      : phase === 'both'
        ? [redis, postgres]
        : [postgres],
  );
  const route = await import('../../app/api/token/route');
  return { phase, POST: route.POST };
}

// Sequential: vi.resetModules between overlapping imports would mix graphs.
// Each instance then serves one throwaway request so its database pools are
// connected; otherwise cold connects stagger the burst and the requests stop
// overlapping, which hides a broken lock.
async function startInstances(phases: Phase[]): Promise<Instance[]> {
  const instances: Instance[] = [];
  for (const phase of phases) instances.push(await startInstance(phase));
  await Promise.all(
    instances.map((instance) =>
      instance.POST(refreshRequest(`rt-warmup-${randomUUID()}`)),
    ),
  );
  return instances;
}

async function seedRefreshToken(): Promise<string> {
  vi.resetModules();
  const { model } = await import('../oauth/model');
  await model.saveClient(CLIENT);
  const refreshToken = `rt-${randomUUID()}`;
  const accessToken = `at-${randomUUID()}`;
  await model.saveToken({
    accessToken,
    refreshToken,
    expires_at: Date.now() + 3_600_000,
    client: { id: CLIENT.id, client_name: CLIENT.client_name, grants: [] },
    user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
    scope: 'read write',
  });
  await model.saveRefreshToken({ refreshToken, accessToken });
  return refreshToken;
}

function refreshRequest(refreshToken: string): NextRequest {
  return new NextRequest('http://localhost/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT.id,
      client_secret: CLIENT.secret,
    }).toString(),
  });
}

type TokenResponse = {
  status: number;
  body: { access_token?: string; refresh_token?: string; error?: string };
};

async function refreshConcurrently(
  instances: Instance[],
  refreshToken: string,
  requests: number,
): Promise<TokenResponse[]> {
  return Promise.all(
    Array.from({ length: requests }, async (_, i) => {
      const response = await instances[i % instances.length].POST(
        refreshRequest(refreshToken),
      );
      return { status: response.status, body: await response.json() };
    }),
  );
}

function expectOneRotation(responses: TokenResponse[]): string {
  expect(responses.map((r) => r.status)).toEqual(responses.map(() => 200));
  const pairs = new Set(
    responses.map((r) => `${r.body.access_token}|${r.body.refresh_token}`),
  );
  expect(pairs.size).toBe(1);
  const refreshToken = responses[0].body.refresh_token;
  if (!refreshToken) throw new Error('expected a refresh token');
  return refreshToken;
}

beforeAll(async () => {
  databaseUrl = await ensureTestOauthDatabase();
  vi.resetModules();
  const stores = await import('../oauth/refresh-lock-store');
  await stores.ensureRefreshLockSchema(databaseUrl);
}, 60_000);

beforeEach(() => {
  shared.redis.clear();
  shared.upstreamCalls = 0;
  shared.upstreamLatencyMs = 300;
  shared.presented.clear();
  shared.reuse = [];
});

describe('refresh rotation across lock rollout phases', () => {
  it.each([
    ['redis', 'both'],
    ['both', 'postgres'],
  ] as const)(
    '%s and %s instances forward each refresh token upstream once',
    async (first, second) => {
      shared.upstreamLatencyMs = 1_500;
      const instances = await startInstances([first, second, first, second]);
      const refreshToken = await seedRefreshToken();

      const responses = await refreshConcurrently(instances, refreshToken, 24);

      expectOneRotation(responses);
      expect(shared.upstreamCalls).toBe(1);
      expect(shared.reuse).toEqual([]);
    },
    60_000,
  );

  it('keeps the chain going on a restarted instance with the returned refresh token', async () => {
    const before = await startInstances(['postgres', 'postgres']);
    const first = expectOneRotation(
      await refreshConcurrently(before, await seedRefreshToken(), 10),
    );

    const after = await startInstances(['postgres', 'postgres']);
    const second = expectOneRotation(
      await refreshConcurrently(after, first, 10),
    );

    expect(second).not.toBe(first);
    expect(shared.upstreamCalls).toBe(2);
    expect(shared.reuse).toEqual([]);
  }, 60_000);

  it('holds the Postgres lock through heartbeats while upstream is slow', async () => {
    shared.upstreamLatencyMs = 3_500;
    const instances = await startInstances([
      'postgres',
      'postgres',
      'postgres',
    ]);

    const responses = await refreshConcurrently(
      instances,
      await seedRefreshToken(),
      9,
    );

    expectOneRotation(responses);
    expect(shared.upstreamCalls).toBe(1);
    expect(shared.reuse).toEqual([]);
  }, 60_000);
});
