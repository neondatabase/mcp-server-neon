/**
 * A refresh token is usable and revocable only by the client it was issued
 * to, including through the refresh result cache, the failure cache, and the
 * lock waiters. Runs the /api/token and /api/revoke routes against the real
 * OAuth Postgres database (tokens, both caches, the Postgres lock); only
 * upstream Hydra is replaced.
 */

import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureTestOauthDatabase } from './ensure-test-oauth-database';

const upstream = { calls: 0, latencyMs: 0 };

vi.mock('../../lib/oauth/client', () => ({
  exchangeRefreshToken: async () => {
    upstream.calls++;
    await new Promise((r) => setTimeout(r, upstream.latencyMs));
    return {
      access_token: `at-${randomUUID()}`,
      refresh_token: `rt-${randomUUID()}`,
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

type TestClient = { id: string; secret: string };
type TokenBody = {
  access_token?: string;
  refresh_token?: string;
  error?: string;
};

const owner: TestClient = { id: `owner-${randomUUID()}`, secret: 'owner' };
const other: TestClient = { id: `other-${randomUUID()}`, secret: 'other' };

let tokenRoute: typeof import('../../app/api/token/route');
let revokeRoute: typeof import('../../app/api/revoke/route');
let model: typeof import('../oauth/model').model;

beforeAll(async () => {
  const databaseUrl = await ensureTestOauthDatabase();
  const stores = await import('../oauth/refresh-lock-store');
  await stores.ensureRefreshLockSchema(databaseUrl);
  const lock = await import('../oauth/refresh-lock');
  lock.__setRefreshLockStoresForTests([
    stores.createPostgresRefreshLockStore(databaseUrl),
  ]);
  model = (await import('../oauth/model')).model;
  tokenRoute = await import('../../app/api/token/route');
  revokeRoute = await import('../../app/api/revoke/route');
  for (const client of [owner, other]) {
    await model.saveClient({
      id: client.id,
      secret: client.secret,
      grants: ['authorization_code', 'refresh_token'],
      redirect_uris: ['http://localhost/callback'],
      tokenEndpointAuthMethod: 'client_secret_post',
    });
  }
}, 60_000);

beforeEach(() => {
  upstream.calls = 0;
  upstream.latencyMs = 0;
});

async function seedRefreshToken(): Promise<string> {
  const refreshToken = `rt-${randomUUID()}`;
  const accessToken = `at-${randomUUID()}`;
  await model.saveToken({
    accessToken,
    refreshToken,
    expires_at: Date.now() + 3_600_000,
    client: { id: owner.id, grants: [] },
    user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
    scope: 'read write',
  });
  await model.saveRefreshToken({ refreshToken, accessToken });
  return refreshToken;
}

function form(
  path: string,
  client: TestClient,
  fields: Record<string, string>,
) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ...fields,
      client_id: client.id,
      client_secret: client.secret,
    }).toString(),
  });
}

async function refresh(client: TestClient, refreshToken: string) {
  const response = await tokenRoute.POST(
    form('/api/token', client, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  );
  return {
    status: response.status,
    body: (await response.json()) as TokenBody,
  };
}

async function revoke(client: TestClient, token: string): Promise<number> {
  const response = await revokeRoute.POST(
    form('/api/revoke', client, { token }),
  );
  return response.status;
}

const pair = (body: TokenBody) => [body.access_token, body.refresh_token];

function expectRejected(result: { status: number; body: TokenBody }) {
  expect(result.status).toBe(400);
  expect(result.body.error).toBe('invalid_grant');
  expect(result.body.access_token).toBeUndefined();
}

describe('refresh token client binding', () => {
  it('serves a rotated token replay to its owner and not to another client', async () => {
    const rotated = await seedRefreshToken();
    const first = await refresh(owner, rotated);
    expect(first.status).toBe(200);

    expectRejected(await refresh(other, rotated));
    const replay = await refresh(owner, rotated);

    expect(replay.status).toBe(200);
    expect(pair(replay.body)).toEqual(pair(first.body));
    expect(upstream.calls).toBe(1);
  });

  it('keeps a current token working for its owner after another client presents it', async () => {
    const refreshToken = await seedRefreshToken();

    expectRejected(await refresh(other, refreshToken));
    expectRejected(await refresh(other, refreshToken));
    expect(upstream.calls).toBe(0);

    expect((await refresh(owner, refreshToken)).status).toBe(200);
    expect(upstream.calls).toBe(1);
  });

  it('rotates once for the owner while another client races it', async () => {
    upstream.latencyMs = 300;
    const refreshToken = await seedRefreshToken();

    const [intruder, ...owners] = await Promise.all([
      refresh(other, refreshToken),
      ...Array.from({ length: 5 }, () => refresh(owner, refreshToken)),
    ]);

    expectRejected(intruder);
    expect(owners.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(new Set(owners.map((r) => r.body.refresh_token)).size).toBe(1);
    expect(upstream.calls).toBe(1);
  });

  it('attributes cached rotations written without a client through the chain', async () => {
    const first = await seedRefreshToken();
    const second = await refresh(owner, first);
    const secondToken = second.body.refresh_token!;
    expect((await refresh(owner, secondToken)).status).toBe(200);
    for (const key of [first, secondToken]) {
      const row = (await model.getRefreshResult(key))!;
      delete row.clientId;
      await model.saveRefreshResult(key, row);
    }

    expectRejected(await refresh(other, first));
    const replay = await refresh(owner, first);

    expect(replay.status).toBe(200);
    expect(pair(replay.body)).toEqual(pair(second.body));
    expect(upstream.calls).toBe(2);
  });

  it('attributes a cached rotation without a client whose new pair was never persisted', async () => {
    const rotated = await seedRefreshToken();
    const cached = {
      accessToken: `at-${randomUUID()}`,
      refreshToken: `rt-${randomUUID()}`,
      expiresAt: Date.now() + 3_600_000,
      scope: 'read write',
    };
    await model.saveRefreshResult(rotated, cached);

    expectRejected(await refresh(other, rotated));
    const replay = await refresh(owner, rotated);

    expect(replay.status).toBe(200);
    expect(pair(replay.body)).toEqual([
      cached.accessToken,
      cached.refreshToken,
    ]);
    expect(upstream.calls).toBe(0);
  });
});

describe('refresh token revocation client binding', () => {
  it('ignores another client revoking the token', async () => {
    const refreshToken = await seedRefreshToken();

    expect(await revoke(other, refreshToken)).toBe(200);

    expect(await model.getRefreshToken(refreshToken)).toBeDefined();
    expect((await refresh(owner, refreshToken)).status).toBe(200);
  });

  it('revokes the token for its owner', async () => {
    const refreshToken = await seedRefreshToken();

    expect(await revoke(owner, refreshToken)).toBe(200);

    expect(await model.getRefreshToken(refreshToken)).toBeUndefined();
    expectRejected(await refresh(owner, refreshToken));
    expect(upstream.calls).toBe(0);
  });
});
