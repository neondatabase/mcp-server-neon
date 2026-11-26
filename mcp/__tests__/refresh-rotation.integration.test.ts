/**
 * Refresh-token rotation across independently loaded /api/token instances
 * that share the real OAuth Postgres database (tokens, refresh result cache,
 * failure cache and the lock). Instances run side by side on Vercel, so
 * together they must still forward every refresh token upstream exactly once.
 *
 * The upstream stand-in records refresh-token reuse, which is what makes
 * Hydra revoke a user's whole token chain.
 */

import { createHash, randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureTestOauthDatabase } from './ensure-test-oauth-database';

const shared = {
  upstreamCalls: 0,
  upstreamLatencyMs: 300,
  presented: new Set<string>(),
  reuse: [] as string[],
};

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

type Instance = {
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

// A fresh module graph per instance: its own RefreshInflight, its own lock
// store client, its own Keyv pools. Only the database is shared.
async function startInstance(): Promise<Instance> {
  vi.resetModules();
  const lock = await import('../oauth/refresh-lock');
  const stores = await import('../oauth/refresh-lock-store');
  lock.__setRefreshLockStoreForTests(
    stores.createPostgresRefreshLockStore(databaseUrl),
  );
  const route = await import('../../app/api/token/route');
  return { POST: route.POST };
}

// Sequential: vi.resetModules between overlapping imports would mix graphs.
// Each instance then serves one throwaway request so its database pools are
// connected; otherwise cold connects stagger the burst and the requests stop
// overlapping, which hides a broken lock.
async function startInstances(count: number): Promise<Instance[]> {
  const instances: Instance[] = [];
  for (let i = 0; i < count; i++) instances.push(await startInstance());
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
  shared.upstreamCalls = 0;
  shared.upstreamLatencyMs = 300;
  shared.presented.clear();
  shared.reuse = [];
});

describe('refresh rotation across instances', () => {
  it('forwards each refresh token upstream once from four instances', async () => {
    shared.upstreamLatencyMs = 1_500;
    const instances = await startInstances(4);
    const refreshToken = await seedRefreshToken();

    const responses = await refreshConcurrently(instances, refreshToken, 24);

    expectOneRotation(responses);
    expect(shared.upstreamCalls).toBe(1);
    expect(shared.reuse).toEqual([]);
  }, 60_000);

  it('keeps the chain going on a restarted instance with the returned refresh token', async () => {
    const before = await startInstances(2);
    const first = expectOneRotation(
      await refreshConcurrently(before, await seedRefreshToken(), 10),
    );

    const after = await startInstances(2);
    const second = expectOneRotation(
      await refreshConcurrently(after, first, 10),
    );

    expect(second).not.toBe(first);
    expect(shared.upstreamCalls).toBe(2);
    expect(shared.reuse).toEqual([]);
  }, 60_000);

  it('holds the Postgres lock through heartbeats while upstream is slow', async () => {
    shared.upstreamLatencyMs = 3_500;
    const instances = await startInstances(3);
    const refreshToken = await seedRefreshToken();
    const key = createHash('sha256').update(refreshToken).digest('hex');
    const sql = neon(databaseUrl);
    const lockExpiry = async () => {
      const rows = await sql`
        SELECT extract(epoch FROM expires_at) * 1000 AS ms
        FROM mcpauth.refresh_locks WHERE key = ${key}
      `;
      return rows.length === 1 ? Number(rows[0].ms) : undefined;
    };

    const pending = refreshConcurrently(instances, refreshToken, 9);
    await new Promise((r) => setTimeout(r, 1_000));
    const early = await lockExpiry();
    await new Promise((r) => setTimeout(r, 2_000));
    const late = await lockExpiry();
    const responses = await pending;

    expect(early).toBeDefined();
    expect(late).toBeDefined();
    expect(late! - early!).toBeGreaterThan(1_500);
    expectOneRotation(responses);
    expect(shared.upstreamCalls).toBe(1);
    expect(shared.reuse).toEqual([]);
  }, 60_000);
});
