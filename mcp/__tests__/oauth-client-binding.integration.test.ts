/**
 * A refresh token is usable and revocable only by the client it was issued
 * to, including through the refresh result cache, the failure cache, and the
 * lock waiters, and a rotated one is replayable only within the grace period.
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
import { z } from 'zod';
import { ensureTestOauthDatabase } from './ensure-test-oauth-database';
import { logger } from '../utils/logger';
import type { RefreshLockStore } from '../oauth/refresh-lock-store';

const upstream = { calls: 0, latencyMs: 0, rotate: true };

vi.mock('../../lib/oauth/client', () => ({
  exchangeRefreshToken: async () => {
    upstream.calls++;
    await new Promise((r) => setTimeout(r, upstream.latencyMs));
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
  expires_in?: number;
  error?: string;
};

const owner: TestClient = { id: `owner-${randomUUID()}`, secret: 'owner' };
const other: TestClient = { id: `other-${randomUUID()}`, secret: 'other' };

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
  upstream.latencyMs = 0;
  upstream.rotate = true;
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

  it('answers a stored code whose user does not decode with 500 and saves no token', async () => {
    const authorizationCode = `code-${randomUUID()}`;
    const accessToken = `at-${randomUUID()}`;

    await model.saveAuthorizationCode({
      authorizationCode,
      expiresAt: new Date(Date.now() + 60_000),
      redirectUri: 'http://localhost/callback',
      scope: 'read write',
      client: { id: owner.id, grants: [] },
      user: { id: 'user-1' },
      token: {
        access_token: accessToken,
        refresh_token: `rt-${randomUUID()}`,
        access_token_expires_at: Date.now() + 3_600_000,
      },
    });

    const response = await tokenRoute.POST(
      form('/api/token', owner, {
        grant_type: 'authorization_code',
        code: authorizationCode,
        redirect_uri: 'http://localhost/callback',
      }),
    );

    expect(response.status).toBe(500);
    await expect(model.getAccessToken(accessToken)).resolves.toBeUndefined();
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
    const expiry = async (key: string) =>
      (await getRefreshResults().get(key, { raw: true }))?.expires;
    const expiries = [await expiry(first), await expiry(secondToken)];

    expectRejected(await refresh(other, first));

    for (const key of [first, secondToken]) {
      expect((await model.getRefreshResult(key))?.clientId).toBe(owner.id);
    }
    expect([await expiry(first), await expiry(secondToken)]).toEqual(expiries);
    const replay = await refresh(owner, first);
    expect(replay.status).toBe(200);
    expect(pair(replay.body)).toEqual(pair(second.body));
    expect(upstream.calls).toBe(2);
  });

  it('rejects an ownerless cached chain from the failure cache without walking it again', async () => {
    const first = await seedRefreshToken();
    const second = (await refresh(owner, first)).body.refresh_token!;
    const third = (await refresh(owner, second)).body;
    expect(await revoke(owner, third.refresh_token!)).toBe(200);
    for (const key of [first, second]) {
      const row = (await model.getRefreshResult(key))!;
      delete row.clientId;
      await model.saveRefreshResult(key, row);
    }

    expectRejected(await refresh(owner, first));
    const lookups = vi.spyOn(model, 'getAccessToken');
    try {
      expectRejected(await refresh(owner, first));
      expect(lookups).not.toHaveBeenCalled();
    } finally {
      lookups.mockRestore();
    }
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

const GRACE_MS = 5 * 60_000;

const ReplayAttributes = z.object({
  clientId: z.string(),
  replayAgeMs: z.number(),
  replayNext: z.enum(['live', 'rotated', 'gone']),
  clientApplication: z.string(),
});

type SloCall = {
  message: string;
  replay: z.infer<typeof ReplayAttributes> | undefined;
};

const sloCalls = (): SloCall[] => {
  const calls: unknown[][] = vi.mocked(logger.info).mock.calls;

  return calls.flatMap(([message, attributes]) => {
    const line = z.string().startsWith('[SLO] refresh ').safeParse(message);

    if (!line.success) {
      return [];
    }

    const replay = ReplayAttributes.safeParse(attributes);

    return [
      { message: line.data, replay: replay.success ? replay.data : undefined },
    ];
  });
};

const lastSlo = (): SloCall => {
  const call = sloCalls().at(-1);

  if (call === undefined) {
    throw new Error('No [SLO] refresh line was logged');
  }

  return call;
};

const replayNexts = (): (string | undefined)[] =>
  sloCalls().map(({ replay }) => replay?.replayNext);

const required = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) {
    throw new Error(`Missing ${what}`);
  }

  return value;
};

const rotate = async (refreshToken: string): Promise<string> => {
  const { status, body } = await refresh(owner, refreshToken);

  if (status !== 200) {
    throw new Error(`Refresh returned ${status}`);
  }

  return required(body.refresh_token, 'refresh_token');
};

const advance = (ms: number): void => {
  vi.setSystemTime(Date.now() + ms);
};

const DAY_MS = 24 * 60 * 60_000;

const lateServes = (): unknown[] => {
  const calls: unknown[][] = vi.mocked(logger.info).mock.calls;

  return calls.flatMap(([message, attributes]) =>
    z.literal('Served a late replay of a live rotation').safeParse(message)
      .success
      ? [attributes]
      : [],
  );
};

const unavailableLock = {
  name: 'postgres',
  tryAcquire: async () => {
    throw new Error('lock store unavailable');
  },
  isHeld: async () => false,
  extend: async () => undefined,
  release: async () => undefined,
  markTransient: async () => undefined,
  hasTransient: async () => false,
} satisfies RefreshLockStore;

const seedRetained = async (
  old: string,
): Promise<{ current: string; restore: () => Promise<void> }> => {
  const oldRecord = required(
    await model.getRefreshToken(old),
    'refresh token record',
  );

  const oldToken = required(
    await model.getAccessToken(oldRecord.accessToken),
    'access token',
  );

  const current = await rotate(old);

  return {
    current,
    restore: async () => {
      await model.saveToken(oldToken);
      await model.saveRefreshToken(oldRecord);
    },
  };
};

describe('refresh token replay grace period', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date());
    vi.mocked(logger.info).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('serves a late replay while the issued token is unused, with the remaining lifetime', async () => {
    const rotated = await seedRefreshToken();
    const first = await refresh(owner, rotated);

    advance(GRACE_MS + 60_000);

    const late = await refresh(owner, rotated);

    expect(late.status).toBe(200);
    expect(pair(late.body)).toStrictEqual(pair(first.body));
    expect(late.body.expires_in).toBe(3600 - (GRACE_MS + 60_000) / 1000);
    expect(lateServes()).toStrictEqual([
      {
        clientId: owner.id,
        replayAgeMs: GRACE_MS + 60_000,
        clientApplication: 'cursor',
      },
    ]);
    expect(upstream.calls).toBe(1);
  });

  it('serves a replay days after the rotation with expires_in 0, and the returned token refreshes', async () => {
    const rotated = await seedRefreshToken();
    const first = await refresh(owner, rotated);

    advance(2 * DAY_MS);

    const late = await refresh(owner, rotated);

    expect(late.status).toBe(200);
    expect(pair(late.body)).toStrictEqual(pair(first.body));
    expect(late.body.expires_in).toBe(0);

    await rotate(required(late.body.refresh_token, 'refresh_token'));

    expect(upstream.calls).toBe(2);
  });

  it('keeps expires_in within the grace period', async () => {
    const rotated = await seedRefreshToken();

    await rotate(rotated);
    advance(60_000);

    const replay = await refresh(owner, rotated);

    expect(replay.body.expires_in).toBe(3600 - 60);
  });

  it('serves a replay within the grace period even after the issued token was rotated', async () => {
    const rotated = await seedRefreshToken();
    const second = await rotate(rotated);

    await rotate(second);
    advance(GRACE_MS - 1);

    const replay = await refresh(owner, rotated);

    expect(replay.status).toBe(200);
    expect(replay.body.refresh_token).toBe(second);
  });

  it('rejects a replay after the grace period once the issued token was rotated again', async () => {
    const first = await seedRefreshToken();
    const second = await rotate(first);
    const third = await rotate(second);

    advance(GRACE_MS);
    vi.mocked(logger.info).mockClear();
    expectRejected(await refresh(owner, first));

    expect(lastSlo().message).toContain('reason=replay_after_grace');
    expect(lastSlo().replay).toStrictEqual({
      clientId: owner.id,
      replayAgeMs: GRACE_MS,
      replayNext: 'rotated',
      clientApplication: 'cursor',
    });

    const latest = await refresh(owner, second);

    expect(latest.status).toBe(200);
    expect(latest.body.refresh_token).toBe(third);

    await rotate(third);

    expect(upstream.calls).toBe(3);
  });

  it('logs every rejected replay, including retries served from the failure cache', async () => {
    const rotated = await seedRefreshToken();

    await rotate(await rotate(rotated));
    advance(GRACE_MS + 60_000);
    vi.mocked(logger.info).mockClear();
    expectRejected(await refresh(owner, rotated));
    expectRejected(await refresh(owner, rotated));

    expect(replayNexts()).toStrictEqual(['rotated', 'rotated']);
    expect(upstream.calls).toBe(2);
  });

  it('logs every one of concurrent rejected replays', async () => {
    const rotated = await seedRefreshToken();

    await rotate(await rotate(rotated));
    advance(GRACE_MS);
    vi.mocked(logger.info).mockClear();

    const results = await Promise.all(
      Array.from({ length: 5 }, async () => refresh(owner, rotated)),
    );

    for (const result of results) {
      expectRejected(result);
    }

    expect(replayNexts()).toStrictEqual(
      Array.from({ length: 5 }, () => 'rotated'),
    );
    expect(upstream.calls).toBe(2);
  });

  it('serves every one of concurrent late replays of a live rotation', async () => {
    const rotated = await seedRefreshToken();
    const issued = await rotate(rotated);

    advance(DAY_MS);
    vi.mocked(logger.info).mockClear();

    const results = await Promise.all(
      Array.from({ length: 5 }, async () => refresh(owner, rotated)),
    );

    expect(results.map(({ status }) => status)).toStrictEqual(
      Array.from({ length: 5 }, () => 200),
    );
    expect(lateServes()).toHaveLength(5);
    expect(
      new Set(results.map(({ body }) => body.refresh_token)),
    ).toStrictEqual(new Set([issued]));
    expect(upstream.calls).toBe(1);
  });

  it('recovers a client whose late replay was rejected and cached as a failure', async () => {
    const rotated = await seedRefreshToken();
    const issued = await rotate(rotated);

    advance(DAY_MS);
    await model.saveRefreshFailure(rotated, {
      failedAt: Date.now(),
      oauthError: 'invalid_grant',
      oauthErrorDescription: 'replay_after_grace',
    });
    await expect(model.getRefreshFailure(rotated)).resolves.toBeDefined();
    vi.mocked(logger.info).mockClear();

    const results = await Promise.all(
      Array.from({ length: 3 }, async () => refresh(owner, rotated)),
    );

    expect(results.map(({ body }) => body.refresh_token)).toStrictEqual([
      issued,
      issued,
      issued,
    ]);
    expect(
      sloCalls().map(({ message }) =>
        message.includes('reason=cache_replay_over_failure'),
      ),
    ).toStrictEqual([true, true, true]);
    expectRejected(await refresh(other, rotated));
  });

  it('reports a replay whose chain was revoked', async () => {
    const rotated = await seedRefreshToken();
    const current = await rotate(rotated);

    await expect(revoke(owner, current)).resolves.toBe(200);
    advance(GRACE_MS);
    expectRejected(await refresh(owner, rotated));

    expect(lastSlo().replay?.replayNext).toBe('gone');
  });

  it('serves the owner after the grace period when another client presented the token first', async () => {
    const rotated = await seedRefreshToken();
    const issued = await rotate(rotated);

    advance(GRACE_MS);
    expectRejected(await refresh(other, rotated));

    const replay = await refresh(owner, rotated);

    expect(replay.body.refresh_token).toBe(issued);
    expect(upstream.calls).toBe(1);
  });

  it('serves a late replay whose old records survived cleanup without calling upstream', async () => {
    const old = await seedRefreshToken();
    const { current, restore } = await seedRetained(old);

    await restore();
    advance(GRACE_MS);

    const replay = await refresh(owner, old);

    expect(replay.body.refresh_token).toBe(current);
    expect(upstream.calls).toBe(1);
  });

  it('serves a late replay without calling upstream when the refresh lock is unavailable', async () => {
    const old = await seedRefreshToken();
    const { current, restore } = await seedRetained(old);
    const lock = await import('../oauth/refresh-lock');
    const stores = await import('../oauth/refresh-lock-store');
    const databaseUrl = await ensureTestOauthDatabase();

    await restore();
    advance(GRACE_MS);
    lock.__setRefreshLockStoresForTests([unavailableLock]);

    try {
      const replay = await refresh(owner, old);

      expect(replay.body.refresh_token).toBe(current);
      expect(upstream.calls).toBe(1);
    } finally {
      lock.__setRefreshLockStoresForTests([
        stores.createPostgresRefreshLockStore(databaseUrl),
      ]);
    }
  });

  it('rejects a rotated token whose new pair was never persisted without calling upstream', async () => {
    const old = await seedRefreshToken();

    await model.saveRefreshResult(old, {
      clientId: owner.id,
      accessToken: `at-${randomUUID()}`,
      refreshToken: `rt-${randomUUID()}`,
      expiresAt: Date.now() + 3_600_000,
      scope: 'read write',
    });
    advance(GRACE_MS);
    expectRejected(await refresh(owner, old));

    expect(upstream.calls).toBe(0);
    expect(lastSlo().replay?.replayNext).toBe('gone');
  });

  it('keeps refreshing a token that upstream did not rotate', async () => {
    upstream.rotate = false;

    const refreshToken = await seedRefreshToken();

    await expect(rotate(refreshToken)).resolves.toBe(refreshToken);
    advance(GRACE_MS + 60_000);
    await expect(rotate(refreshToken)).resolves.toBe(refreshToken);

    expect(upstream.calls).toBe(2);
  });

  it('serves a row written without a client from its first write and keeps its expiry', async () => {
    const first = await seedRefreshToken();
    const second = await rotate(first);
    const row = required(await model.getRefreshResult(first), 'cached row');

    await getRefreshResults().set(
      first,
      { ...row, clientId: undefined },
      7 * DAY_MS,
    );

    const before = await getRefreshResults().get(first, { raw: true });

    advance(DAY_MS);

    const replay = await refresh(owner, first);

    expect(replay.body.refresh_token).toBe(second);
    expectRejected(await refresh(other, first));

    const after = await getRefreshResults().get(first, { raw: true });

    expect(after?.value?.clientId).toBe(owner.id);
    expect(after?.expires).toBe(before?.expires);
  });

  it('revokes a rotated token for its owner, with the unused token it issued', async () => {
    const rotated = await seedRefreshToken();
    const issued = await rotate(rotated);

    advance(DAY_MS);
    await expect(revoke(owner, rotated)).resolves.toBe(200);
    expectRejected(await refresh(owner, rotated));
    expectRejected(await refresh(owner, issued));

    expect(upstream.calls).toBe(1);
  });

  it('completes the revocation of a rotated token when a failed attempt is retried', async () => {
    const rotated = await seedRefreshToken();
    const issued = await rotate(rotated);

    const deleteToken = vi
      .spyOn(model, 'deleteToken')
      .mockRejectedValueOnce(new Error('connection reset'));

    advance(DAY_MS);

    try {
      await expect(revoke(owner, rotated)).resolves.not.toBe(200);
    } finally {
      deleteToken.mockRestore();
    }

    await expect(revoke(owner, rotated)).resolves.toBe(200);
    expectRejected(await refresh(owner, rotated));
    expectRejected(await refresh(owner, issued));
  });

  it('ignores another client revoking a rotated token', async () => {
    const rotated = await seedRefreshToken();
    const issued = await rotate(rotated);

    advance(DAY_MS);
    await expect(revoke(other, rotated)).resolves.toBe(200);

    const replay = await refresh(owner, rotated);

    expect(replay.body.refresh_token).toBe(issued);
  });

  it('revokes a rotated token whose old records survived cleanup', async () => {
    const old = await seedRefreshToken();
    const { current, restore } = await seedRetained(old);

    await restore();
    advance(DAY_MS);
    await expect(revoke(owner, old)).resolves.toBe(200);
    expectRejected(await refresh(owner, old));
    expectRejected(await refresh(owner, current));
  });

  it('stops serving a live rotation once its cached row expires', async () => {
    const rotated = await seedRefreshToken();

    await rotate(rotated);
    advance(7 * DAY_MS + 60_000);
    expectRejected(await refresh(owner, rotated));

    expect(upstream.calls).toBe(1);
  });
});
