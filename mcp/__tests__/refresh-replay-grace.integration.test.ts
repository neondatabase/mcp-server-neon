/**
 * A rotated refresh token is replayable by its owner for
 * REFRESH_REPLAY_GRACE_MS after the rotation, then rejected without reaching
 * upstream, and each rejection is logged as `reason=replay_after_grace`.
 * Runs the /api/token and /api/revoke routes against the real OAuth Postgres
 * database (tokens, both caches, the Postgres lock); only upstream Hydra is
 * replaced.
 */

import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { ensureTestOauthDatabase } from './ensure-test-oauth-database';
import { logger } from '../utils/logger';

const upstream = { calls: 0, rotate: true };

vi.mock('../../lib/oauth/client', () => ({
  exchangeRefreshToken: async () => {
    upstream.calls++;
    return {
      access_token: `at-${randomUUID()}`,
      refresh_token: upstream.rotate ? `rt-${randomUUID()}` : undefined,
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

const GRACE_MS = 5 * 60_000;

let tokenRoute: typeof import('../../app/api/token/route');
let revokeRoute: typeof import('../../app/api/revoke/route');
let model: typeof import('../oauth/model').model;
let getRefreshResults: typeof import('../oauth/kv-store').getRefreshResults;

beforeAll(async () => {
  const databaseUrl = await ensureTestOauthDatabase();
  const stores = await import('../oauth/refresh-lock-store');
  await stores.ensureRefreshLockSchema(databaseUrl);
  const lock = await import('../oauth/refresh-lock');
  lock.__setRefreshLockStoresForTests([
    stores.createPostgresRefreshLockStore(databaseUrl),
  ]);
  model = (await import('../oauth/model')).model;
  getRefreshResults = (await import('../oauth/kv-store')).getRefreshResults;
  tokenRoute = await import('../../app/api/token/route');
  revokeRoute = await import('../../app/api/revoke/route');
  for (const client of [owner, other]) {
    await model.saveClient({
      id: client.id,
      secret: client.secret,
      grants: ['authorization_code', 'refresh_token'],
      redirect_uris: ['http://localhost/callback'],
      tokenEndpointAuthMethod: 'client_secret_post',
      client_name: 'Cursor',
    });
  }
}, 60_000);

beforeEach(() => {
  upstream.calls = 0;
  upstream.rotate = true;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date());
  vi.mocked(logger.info).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

async function seedRefreshToken(): Promise<{
  refreshToken: string;
  accessToken: string;
}> {
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
  return { refreshToken, accessToken };
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

function sloLines(): string[] {
  return vi
    .mocked(logger.info)
    .mock.calls.map(([message]) => String(message))
    .filter((message) => message.startsWith('[SLO] refresh '));
}

function lastSloLine(): string {
  const lines = sloLines();
  expect(lines.length).toBeGreaterThan(0);
  return lines[lines.length - 1];
}

function replayFields(line: string) {
  return {
    outcome: /outcome=(\S+)/.exec(line)?.[1],
    reason: /reason=(\S+)/.exec(line)?.[1],
    ageMs: Number(/replayAgeMs=(\d+)/.exec(line)?.[1]),
    next: /replayNext=(\S+)/.exec(line)?.[1],
    clientApplication: /clientApplication=(\S+)/.exec(line)?.[1],
  };
}

describe('refresh token replay grace period', () => {
  it('serves the replay until the grace period ends and rejects it from then on', async () => {
    const { refreshToken } = await seedRefreshToken();
    const first = await refresh(owner, refreshToken);
    expect(first.status).toBe(200);

    advance(GRACE_MS - 1);
    const inGrace = await refresh(owner, refreshToken);
    expect(inGrace.status).toBe(200);
    expect(pair(inGrace.body)).toEqual(pair(first.body));

    advance(1);
    expectRejected(await refresh(owner, refreshToken));
    expect(upstream.calls).toBe(1);
    expect(replayFields(lastSloLine())).toEqual({
      outcome: 'correct_invalid_grant',
      reason: 'replay_after_grace',
      ageMs: GRACE_MS,
      next: 'live',
      clientApplication: 'cursor',
    });
    const calls: unknown[][] = vi.mocked(logger.info).mock.calls;
    const [, attributes] = calls
      .filter(([message]) => String(message).startsWith('[SLO] refresh '))
      .at(-1)!;
    expect(attributes).toEqual({
      clientId: owner.id,
      replayAgeMs: GRACE_MS,
      replayNext: 'live',
      clientApplication: 'cursor',
    });

    expect((await refresh(owner, first.body.refresh_token!)).status).toBe(200);
    expect(upstream.calls).toBe(2);
  });

  it('logs every rejected replay, including retries served from the failure cache', async () => {
    const { refreshToken } = await seedRefreshToken();
    expect((await refresh(owner, refreshToken)).status).toBe(200);
    advance(GRACE_MS + 60_000);

    expectRejected(await refresh(owner, refreshToken));
    expectRejected(await refresh(owner, refreshToken));

    const lines = sloLines().slice(-2).map(replayFields);
    expect(lines.map((l) => l.reason)).toEqual([
      'replay_after_grace',
      'replay_after_grace',
    ]);
    expect(lines.map((l) => l.ageMs)).toEqual([
      GRACE_MS + 60_000,
      GRACE_MS + 60_000,
    ]);
    expect(upstream.calls).toBe(1);
  });

  it('rejects a token two rotations back and keeps the live token working', async () => {
    const { refreshToken: first } = await seedRefreshToken();
    const second = (await refresh(owner, first)).body.refresh_token!;
    const third = (await refresh(owner, second)).body.refresh_token!;
    advance(GRACE_MS);

    expectRejected(await refresh(owner, first));
    expect(replayFields(lastSloLine()).next).toBe('rotated');
    expectRejected(await refresh(owner, second));
    expect(replayFields(lastSloLine()).next).toBe('live');

    expect((await refresh(owner, third)).status).toBe(200);
    expect(upstream.calls).toBe(3);
  });

  it('reports a replay whose chain was revoked', async () => {
    const { refreshToken } = await seedRefreshToken();
    const current = (await refresh(owner, refreshToken)).body.refresh_token!;
    expect(await revoke(owner, current)).toBe(200);
    advance(GRACE_MS);

    expectRejected(await refresh(owner, refreshToken));
    expect(replayFields(lastSloLine()).next).toBe('gone');
  });

  it('rejects the owner after the grace period when another client presented the token first', async () => {
    const { refreshToken } = await seedRefreshToken();
    expect((await refresh(owner, refreshToken)).status).toBe(200);
    advance(GRACE_MS);

    expectRejected(await refresh(other, refreshToken));
    expect(replayFields(lastSloLine()).reason).not.toBe('replay_after_grace');
    expectRejected(await refresh(owner, refreshToken));

    expect(replayFields(lastSloLine()).reason).toBe('replay_after_grace');
    expect(upstream.calls).toBe(1);
  });

  it('rejects a rotated token whose old records survived cleanup without calling upstream', async () => {
    const old = await seedRefreshToken();
    const current = (await refresh(owner, old.refreshToken)).body;
    await seedRetained(old);
    advance(GRACE_MS);

    expectRejected(await refresh(owner, old.refreshToken));
    expect(upstream.calls).toBe(1);
    expect(replayFields(lastSloLine()).reason).toBe('replay_after_grace');
    expect((await refresh(owner, current.refresh_token!)).status).toBe(200);
  });

  it('rejects a rotated token whose new pair was never persisted without calling upstream', async () => {
    const old = await seedRefreshToken();
    await model.saveRefreshResult(old.refreshToken, {
      clientId: owner.id,
      accessToken: `at-${randomUUID()}`,
      refreshToken: `rt-${randomUUID()}`,
      expiresAt: Date.now() + 3_600_000,
      scope: 'read write',
    });
    advance(GRACE_MS);

    expectRejected(await refresh(owner, old.refreshToken));
    expect(upstream.calls).toBe(0);
    expect(replayFields(lastSloLine())).toMatchObject({
      reason: 'replay_after_grace',
      next: 'gone',
    });
  });

  it('keeps refreshing a token that upstream did not rotate', async () => {
    upstream.rotate = false;
    const { refreshToken } = await seedRefreshToken();
    const first = await refresh(owner, refreshToken);
    expect(first.body.refresh_token).toBe(refreshToken);
    advance(GRACE_MS + 60_000);

    const second = await refresh(owner, refreshToken);

    expect(second.status).toBe(200);
    expect(second.body.refresh_token).toBe(refreshToken);
    expect(upstream.calls).toBe(2);
  });

  it('measures the grace period of a row written without a client from its first write', async () => {
    const { refreshToken: first } = await seedRefreshToken();
    const second = (await refresh(owner, first)).body.refresh_token!;
    const row = (await model.getRefreshResult(first))!;
    delete row.clientId;
    await getRefreshResults().set(first, row, 7 * 24 * 60 * 60_000);
    const expiry = (await getRefreshResults().get(first, { raw: true }))
      ?.expires;
    advance(GRACE_MS + 60_000);

    expectRejected(await refresh(owner, first));

    expect(replayFields(lastSloLine())).toMatchObject({
      reason: 'replay_after_grace',
      ageMs: GRACE_MS + 60_000,
      next: 'live',
    });
    expect((await model.getRefreshResult(first))?.clientId).toBe(owner.id);
    expect((await getRefreshResults().get(first, { raw: true }))?.expires).toBe(
      expiry,
    );
    expect((await refresh(owner, second)).status).toBe(200);
  });
});

async function seedRetained(old: {
  refreshToken: string;
  accessToken: string;
}): Promise<void> {
  await model.saveToken({
    accessToken: old.accessToken,
    refreshToken: old.refreshToken,
    expires_at: Date.now() + 3_600_000,
    client: { id: owner.id, grants: [] },
    user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
    scope: 'read write',
  });
  await model.saveRefreshToken(old);
}
