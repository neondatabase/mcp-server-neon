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
import { getTokens, getRefreshTokens } from '../oauth/kv-store';
import { logger } from '../utils/logger';
import type { RefreshLockStore } from '../oauth/refresh-lock-store';

type RetiredPair = { accessToken: string; refreshToken?: string };

type UpstreamState = {
  calls: number;
  latencyMs: number;
  rotate: boolean;
  lastAccessToken: string;
  lastRefreshToken: string;
  beforeReturn: () => Promise<void>;
  retired: RetiredPair[];
  retirementFails: boolean;
  beforeRetire: () => Promise<void>;
};

const upstream: UpstreamState = {
  calls: 0,
  latencyMs: 0,
  rotate: true,
  lastAccessToken: '',
  lastRefreshToken: '',
  beforeReturn: async () => {
    /* No barrier unless the test installs one. */
  },
  retired: [],
  retirementFails: false,
  beforeRetire: async () => {
    /* No retirement barrier by default. */
  },
};

vi.mock('../../lib/oauth/client', () => ({
  exchangeRefreshToken: async () => {
    upstream.calls++;
    await new Promise((r) => setTimeout(r, upstream.latencyMs));
    upstream.lastAccessToken = `at-${randomUUID()}`;
    upstream.lastRefreshToken = upstream.rotate ? `rt-${randomUUID()}` : '';
    await upstream.beforeReturn();

    return {
      access_token: upstream.lastAccessToken,
      refresh_token: upstream.lastRefreshToken || undefined,
      expiresIn: () => 3600,
      scope: 'read write',
    };
  },
  revokeUpstreamTokens: async (tokens: RetiredPair) => {
    upstream.retired.push(tokens);
    await upstream.beforeRetire();

    if (upstream.retirementFails) {
      throw new Error('Fixture issuer retirement unavailable');
    }
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
  upstream.lastAccessToken = '';
  upstream.lastRefreshToken = '';
  upstream.beforeReturn = async () => {
    /* No barrier by default. */
  };
  upstream.retired = [];
  upstream.retirementFails = false;
  upstream.beforeRetire = async () => {
    /* No retirement barrier by default. */
  };
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
      ...Array.from({ length: 5 }, async () => refresh(owner, refreshToken)),
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
      delete row.grantFamilyId;
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
    await expect(revoke(owner, third.refresh_token!)).resolves.toBe(200);

    for (const key of [first, second]) {
      const row = (await model.getRefreshResult(key))!;
      delete row.clientId;
      delete row.grantFamilyId;
      await model.saveRefreshResult(key, row);
    }

    expectRejected(await refresh(owner, first));
    const lookups = vi.spyOn(model, 'getStoredAccessToken');

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

    await expect(revoke(other, refreshToken)).resolves.toBe(200);

    await expect(model.getRefreshToken(refreshToken)).resolves.toBeDefined();
    expect((await refresh(owner, refreshToken)).status).toBe(200);
  });

  it('revokes the token for its owner', async () => {
    const refreshToken = await seedRefreshToken();

    await expect(revoke(owner, refreshToken)).resolves.toBe(200);

    await expect(model.getRefreshToken(refreshToken)).resolves.toBeUndefined();
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

const deferred = () => {
  const { promise, resolve } = Promise.withResolvers<undefined>();
  return {
    promise,
    complete: () => {
      resolve(undefined);
    },
  };
};

describe('explicit revocation of a refresh family', () => {
  it('rejects a predecessor cache replay immediately after revoking the current token', async () => {
    const old = await seedRefreshToken();
    const current = await rotate(old);
    await expect(revoke(owner, current)).resolves.toBe(200);
    expectRejected(await refresh(owner, old));
  });

  it('denies the live descendant when an older rotation is explicitly revoked', async () => {
    const first = await seedRefreshToken();
    const second = await rotate(first);
    const third = await rotate(second);
    const accessToken = upstream.lastAccessToken;
    await expect(revoke(owner, first)).resolves.toBe(200);
    await expect(model.getAccessToken(accessToken)).resolves.toBeUndefined();
    expectRejected(await refresh(owner, third));
  });

  it('denies an issuer response that completes after its family was revoked', async () => {
    const token = await seedRefreshToken();
    const entered = deferred();
    const release = deferred();
    upstream.beforeReturn = async () => {
      entered.complete();
      await release.promise;
    };

    const pending = refresh(owner, token);
    await entered.promise;

    try {
      await expect(revoke(owner, token)).resolves.toBe(200);
    } finally {
      release.complete();
    }

    expectRejected(await pending);
    await expect(
      model.getAccessToken(upstream.lastAccessToken),
    ).resolves.toBeUndefined();
  });

  it('denies credentials when revocation lands after the result cache write', async () => {
    const token = await seedRefreshToken();
    const save = model.saveRefreshResult.bind(model);
    const spy = vi
      .spyOn(model, 'saveRefreshResult')
      .mockImplementationOnce(async (key, row) => {
        await save(key, row);
        await expect(revoke(owner, token)).resolves.toBe(200);
      });
    try {
      expectRejected(await refresh(owner, token));
      expect(
        await model.getAccessToken(upstream.lastAccessToken),
      ).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });

  it('denies credentials when revocation lands after the access-token write', async () => {
    const token = await seedRefreshToken();
    const save = model.saveToken.bind(model);
    const spy = vi
      .spyOn(model, 'saveToken')
      .mockImplementationOnce(async (row) => {
        const saved = await save(row);
        await expect(revoke(owner, token)).resolves.toBe(200);
        return saved;
      });
    try {
      expectRejected(await refresh(owner, token));
      expect(
        await model.getAccessToken(upstream.lastAccessToken),
      ).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });

  it('denies the final response when revocation lands after the refresh-token write', async () => {
    const token = await seedRefreshToken();
    const save = model.saveRefreshToken.bind(model);
    const spy = vi
      .spyOn(model, 'saveRefreshToken')
      .mockImplementationOnce(async (row) => {
        const saved = await save(row);
        await expect(revoke(owner, token)).resolves.toBe(200);
        return saved;
      });
    try {
      expectRejected(await refresh(owner, token));
      expect(
        await model.getAccessToken(upstream.lastAccessToken),
      ).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});

type LegacyPair = { accessToken: string; refreshToken: string };

const seedLegacyChain = async (boundTerminal = true): Promise<LegacyPair[]> => {
  const pairs = Array.from({ length: 4 }, () => ({
    accessToken: `legacy-at-${randomUUID()}`,
    refreshToken: `legacy-rt-${randomUUID()}`,
  }));

  await Promise.all(
    pairs.map(async (item) => {
      await getTokens().set(item.accessToken, {
        ...item,
        client: { id: owner.id, grants: [] },
        user: { id: 'legacy-user', name: 'Legacy Test User' },
        scope: 'read write',
        expires_at: Date.now() + 3_600_000,
      });
      await getRefreshTokens().set(item.refreshToken, item);
    }),
  );
  await Promise.all(
    pairs.slice(0, -1).map(async (item, index) => {
      const next = required(pairs.at(index + 1), 'legacy successor');
      await model.saveRefreshResult(item.refreshToken, {
        clientId: owner.id,
        ...next,
        expiresAt: Date.now() + 3_600_000,
        scope: 'read write',
      });
    }),
  );

  if (boundTerminal) {
    const terminal = required(pairs.at(-1), 'terminal legacy pair');
    const token = required(
      await model.getStoredAccessToken(terminal.accessToken),
      'terminal record',
    );
    await model.saveToken(token);
  }

  return pairs;
};

describe('legacy family cutover', () => {
  it('keeps a recovered legacy pair denied when current revoke leaves intermediate records', async () => {
    const pairs = await seedLegacyChain();
    const replay = await refresh(owner, pairs[0].refreshToken);
    expect(replay.status).toBe(200);
    await expect(
      model.getAccessToken(pairs[1].accessToken),
    ).resolves.toBeDefined();
    await expect(revoke(owner, pairs[3].refreshToken)).resolves.toBe(200);
    await expect(
      model.getAccessToken(pairs[1].accessToken),
    ).resolves.toBeUndefined();
    expectRejected(await refresh(owner, pairs[0].refreshToken));
  });

  it('denies an unbound predecessor after an ancestor cache link is removed', async () => {
    const pairs = await seedLegacyChain();
    await getRefreshTokens().delete(pairs[1].refreshToken);
    const replay = await refresh(owner, pairs[1].refreshToken);
    expect(replay.status).toBe(200);
    await expect(
      model.getAccessToken(pairs[2].accessToken),
    ).resolves.toBeDefined();
    await expect(revoke(owner, pairs[1].refreshToken)).resolves.toBe(200);
    expectRejected(await refresh(owner, pairs[0].refreshToken));
    await expect(
      model.getAccessToken(pairs[2].accessToken),
    ).resolves.toBeUndefined();
  });

  it('keeps a cold legacy token usable through guarded upgrade binding', async () => {
    const pairs = await seedLegacyChain(false);
    const result = await refresh(owner, pairs[3].refreshToken);

    expect(result.status).toBe(200);
    expect(upstream.calls).toBe(1);
  });
});

describe('grant denial storage and recovery', () => {
  it('does not override a cached failure with a pair from a revoked family', async () => {
    const old = await seedRefreshToken();
    const current = await rotate(old);
    await model.saveRefreshFailure(old, {
      failedAt: Date.now(),
      oauthError: 'invalid_grant',
    });
    await expect(revoke(owner, current)).resolves.toBe(200);
    expectRejected(await refresh(owner, old));
  });

  it('does not rescue a persistence failure with a revoked cached pair', async () => {
    const token = await seedRefreshToken();
    const unavailable = new Error('Fixture persistence unavailable');
    const spy = vi.spyOn(model, 'saveToken').mockRejectedValue(unavailable);
    spy.mockImplementationOnce(async () => {
      const cached = required(
        await model.getRefreshResult(token),
        'cached result',
      );
      await expect(revoke(owner, token)).resolves.toBe(200);
      await getRefreshResults().set(token, cached, 7 * DAY_MS);
      throw unavailable;
    });
    try {
      const result = await refresh(owner, token);
      expect(result.status).not.toBe(200);
      expect(result.body.access_token).toBeUndefined();
      expect(result.body.refresh_token).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });

  it('denies both the holder and a waiting refresh after explicit revocation', async () => {
    const token = await seedRefreshToken();
    const entered = deferred();
    const release = deferred();
    upstream.beforeReturn = async () => {
      entered.complete();
      await release.promise;
    };

    const first = refresh(owner, token);
    await entered.promise;
    const peeked = deferred();
    const read = model.getRefreshRotation.bind(model);

    const spy = vi
      .spyOn(model, 'getRefreshRotation')
      .mockImplementation(async (key) => {
        const row = await read(key);
        peeked.complete();

        return row;
      });

    const second = refresh(owner, token);
    await peeked.promise;

    try {
      await expect(revoke(owner, token)).resolves.toBe(200);
    } finally {
      release.complete();
    }

    try {
      const results = await Promise.all([first, second]);
      expect(
        results
          .map(({ status }) => status)
          .every((status) => [400, 503].includes(status)),
      ).toBe(true);
      expect(results.map(({ body }) => body.access_token)).toStrictEqual([
        undefined,
        undefined,
      ]);
    } finally {
      spy.mockRestore();
    }
  });

  it('rolls back every new marker when one alias already belongs to another grant', async () => {
    const { accessGrantAlias } = await import('../oauth/grant-family');
    const first = accessGrantAlias(owner.id, randomUUID());
    const second = accessGrantAlias(owner.id, randomUUID());
    const occupied = accessGrantAlias(owner.id, randomUUID());
    const fresh = accessGrantAlias(owner.id, randomUUID());

    await model.revokeGrant(first, owner.id, { aliases: [occupied] });
    await expect(
      model.revokeGrant(second, owner.id, {
        aliases: [occupied, fresh],
      }),
    ).rejects.toMatchObject({
      name: 'GrantStateUnavailableError',
      cause: { message: 'OAuth grant denial identity conflict' },
    });

    await expect(model.isGrantRevoked(first)).resolves.toBe(true);
    await expect(model.isGrantRevoked(occupied)).resolves.toBe(true);
    await expect(model.isGrantRevoked(second)).resolves.toBe(false);
    await expect(model.isGrantRevoked(fresh)).resolves.toBe(false);
  });

  it('returns retryable failure when denial cannot be persisted', async () => {
    const token = await seedRefreshToken();

    const record = required(
      await model.getRefreshToken(token),
      'refresh record',
    );

    const spy = vi
      .spyOn(model, 'revokeGrant')
      .mockRejectedValue(new Error('Fixture marker write unavailable'));

    try {
      await expect(revoke(owner, token)).resolves.toBe(503);
      await expect(
        model.getAccessToken(record.accessToken),
      ).resolves.toBeDefined();
      expect(upstream.retired).toStrictEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it('does not authenticate or issue credentials when the denial read fails', async () => {
    const token = await seedRefreshToken();

    const record = required(
      await model.getRefreshToken(token),
      'refresh record',
    );

    const spy = vi
      .spyOn(model, 'isGrantRevoked')
      .mockRejectedValue(new Error('Fixture marker read unavailable'));

    try {
      await expect(model.getAccessToken(record.accessToken)).rejects.toThrow(
        'Fixture marker read unavailable',
      );
      const result = await refresh(owner, token);
      expect(result.status).not.toBe(200);
      expect(result.body.access_token).toBeUndefined();
      expect(result.body.refresh_token).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });

  it('returns retryable failure for an owned cache whose family cannot be resolved', async () => {
    const old = `orphan-${randomUUID()}`;
    await model.saveRefreshResult(old, {
      clientId: owner.id,
      accessToken: `orphan-at-${randomUUID()}`,
      refreshToken: `orphan-rt-${randomUUID()}`,
      expiresAt: Date.now() + 3_600_000,
    });
    await expect(revoke(owner, old)).resolves.toBe(503);
    expect(upstream.retired).toStrictEqual([]);
  });

  it('rejects a cyclic owned chain without treating it as unknown-token success', async () => {
    const first = `cycle-${randomUUID()}`;
    const second = `cycle-${randomUUID()}`;
    await Promise.all(
      [
        [first, second],
        [second, first],
      ].map(async ([key, next]) =>
        model.saveRefreshResult(key, {
          clientId: owner.id,
          grantFamilyId: 'a'.repeat(64),
          accessToken: `cycle-at-${randomUUID()}`,
          refreshToken: next,
          expiresAt: Date.now() + 3_600_000,
        }),
      ),
    );
    await expect(revoke(owner, first)).resolves.toBe(503);
    expect(upstream.retired).toStrictEqual([]);
  });

  it('rejects conflicting stored family identities before recording denial', async () => {
    const first = await seedRefreshToken();
    const second = await rotate(first);
    const cached = required(await model.getRefreshResult(first), 'cache row');
    await model.saveRefreshResult(first, {
      ...cached,
      grantFamilyId: 'b'.repeat(64),
    });
    await expect(revoke(owner, first)).resolves.toBe(503);
    await expect(
      model.getAccessToken(upstream.lastAccessToken),
    ).resolves.toBeDefined();
    const next = await refresh(owner, second);
    expect(next.status).toBe(200);
  });

  it('keeps another bound grant of the same client working', async () => {
    const first = await seedRefreshToken();
    const unrelated = await seedRefreshToken();
    await expect(revoke(owner, first)).resolves.toBe(200);
    const next = await refresh(owner, unrelated);
    expect(next.status).toBe(200);
  });

  it('never publishes the stored grant family in refresh responses', async () => {
    const token = await seedRefreshToken();
    const fresh = await refresh(owner, token);
    const replay = await refresh(owner, token);
    expect(fresh.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(fresh.body).not.toHaveProperty('grantFamilyId');
    expect(replay.body).not.toHaveProperty('grantFamilyId');
  });
});

describe('issuer retirement', () => {
  it('requests retirement of the known current issuer pair on explicit revoke', async () => {
    const token = await seedRefreshToken();

    const stored = required(
      await model.getRefreshToken(token),
      'refresh token',
    );

    await expect(revoke(owner, token)).resolves.toBe(200);
    expect(upstream.retired).toStrictEqual([
      { accessToken: stored.accessToken, refreshToken: token },
    ]);
  });
});

describe('issuer retirement recovery', () => {
  it('retries a failed issuer retirement after local source rows are gone', async () => {
    const token = await seedRefreshToken();
    upstream.retirementFails = true;
    await expect(revoke(owner, token)).resolves.toBe(503);
    await expect(model.getRefreshToken(token)).resolves.toBeUndefined();
    expectRejected(await refresh(owner, token));
    upstream.retirementFails = false;
    await expect(revoke(other, token)).resolves.toBe(200);
    expect(upstream.retired).toHaveLength(1);
    await expect(revoke(owner, token)).resolves.toBe(200);
    expect(upstream.retired).toHaveLength(2);
    expect(upstream.retired[1]).toStrictEqual(upstream.retired[0]);
  });

  it('retains a late issuer pair for retry when compensation fails', async () => {
    const token = await seedRefreshToken();
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    upstream.beforeReturn = async () => {
      entered.resolve(undefined);
      await release.promise;
    };

    const pending = refresh(owner, token);
    await entered.promise;
    await expect(revoke(owner, token)).resolves.toBe(200);
    upstream.retirementFails = true;
    release.resolve(undefined);
    const response = await pending;

    expect(response.status).toBe(503);
    expect(response.body.access_token).toBeUndefined();
    expect(upstream.retired).toContainEqual({
      accessToken: upstream.lastAccessToken,
      refreshToken: upstream.lastRefreshToken,
    });
    upstream.retirementFails = false;
    const beforeRetry = upstream.retired.length;

    await expect(revoke(owner, token)).resolves.toBe(200);
    expect(upstream.retired.slice(beforeRetry)).toContainEqual({
      accessToken: upstream.lastAccessToken,
      refreshToken: upstream.lastRefreshToken,
    });
    expectRejected(await refresh(owner, upstream.lastRefreshToken));
  });

  it('keeps both refresh intents when the issuer reuses an access credential', async () => {
    const token = await seedRefreshToken();

    const record = required(
      await model.getRefreshToken(token),
      'refresh record',
    );

    const stored = required(
      await model.getStoredAccessToken(record.accessToken),
      'access record',
    );

    const family = z.string().parse(stored.grantFamilyId);

    const next = {
      accessToken: record.accessToken,
      refreshToken: `fixture-next-${randomUUID()}`,
    };

    await model.revokeGrant(family, owner.id, {
      pair: { accessToken: record.accessToken, refreshToken: token },
    });
    await model.revokeGrant(family, owner.id, { pair: next });
    const { retireDeniedGrant } = await import('../oauth/grant-retirement');

    await retireDeniedGrant(family, owner.id);
    expect(upstream.retired).toHaveLength(2);
    expect(upstream.retired).toContainEqual(next);
  });
});

describe('captured legacy cache identity', () => {
  it('denies adoption when the captured legacy cache row disappears before tracing', async () => {
    const pairs = await seedLegacyChain();
    await expect(revoke(owner, pairs[3].refreshToken)).resolves.toBe(200);
    const original = model.getRefreshRotation;

    const spy = vi
      .spyOn(model, 'getRefreshRotation')
      .mockImplementationOnce(async (key) => {
        const captured = await original(key);
        await model.deleteRefreshResult(key);

        return captured;
      });

    try {
      const response = await refresh(owner, pairs[0].refreshToken);
      expect(response.status).not.toBe(200);
      expect(response.body.access_token).toBeUndefined();
      await expect(
        model.getAccessToken(pairs[1].accessToken),
      ).resolves.toBeUndefined();
      expect(upstream.calls).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('legacy lineage evidence limits', () => {
  it('derives independent identities when historical records have no connecting evidence', async () => {
    const { traceGrant } = await import('../oauth/grant-family');
    const pairs = await seedLegacyChain(false);

    await model.deleteRefreshResult(pairs[1].refreshToken);

    const lineage = (historicalRecord: LegacyPair) =>
      traceGrant(
        { clientId: owner.id, refreshToken: historicalRecord.refreshToken },
        model,
      );

    const [earlier, later] = await Promise.all([
      lineage(pairs[0]),
      lineage(pairs[3]),
    ]);

    expect(earlier.familyId).not.toBe(later.familyId);
    expect(earlier.aliases).not.toContain(later.familyId);
  });
});

describe('revocation hints and concurrent retirement', () => {
  it.each(['access_token', 'unexpected'])(
    'revokes an owned refresh token with hint %s',
    async (hint) => {
      const token = await seedRefreshToken();

      const response = await revokeRoute.POST(
        form('/api/revoke', owner, { token, token_type_hint: hint }),
      );

      expect(response.status).toBe(200);
      expectRejected(await refresh(owner, token));
      expect(upstream.retired).toHaveLength(1);
    },
  );

  it('drains a failed retirement retry even with the other token hint', async () => {
    const token = await seedRefreshToken();
    upstream.retirementFails = true;
    await expect(revoke(owner, token)).resolves.toBe(503);
    upstream.retirementFails = false;

    const response = await revokeRoute.POST(
      form('/api/revoke', owner, { token, token_type_hint: 'access_token' }),
    );

    expect(response.status).toBe(200);
    expect(upstream.retired).toHaveLength(2);
  });

  it('preserves a concurrently added pair while a retirement snapshot completes', async () => {
    const token = await seedRefreshToken();

    const record = required(
      await model.getRefreshToken(token),
      'refresh record',
    );

    const stored = required(
      await model.getStoredAccessToken(record.accessToken),
      'access record',
    );

    const family = z.string().parse(stored.grantFamilyId);

    const pairs = Array.from({ length: 3 }, () => ({
      accessToken: `intent-at-${randomUUID()}`,
      refreshToken: `intent-rt-${randomUUID()}`,
    }));

    const first = required(pairs[0], 'first intent');
    const second = required(pairs[1], 'second intent');
    const last = required(pairs[2], 'last intent');
    await Promise.all([
      model.revokeGrant(family, owner.id, { pair: first }),
      model.revokeGrant(family, owner.id, { pair: second }),
    ]);
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    upstream.beforeRetire = async () => {
      entered.resolve(undefined);
      await release.promise;
    };

    const { retireDeniedGrant } = await import('../oauth/grant-retirement');

    const { pendingRetirements } =
      await import('../oauth/grant-revocation-store');

    const draining = retireDeniedGrant(family, owner.id);
    await entered.promise;
    await model.revokeGrant(family, owner.id, { pair: last });
    release.resolve(undefined);
    await draining;
    const retained = await pendingRetirements(family, owner.id);

    expect(Object.values(retained)).toStrictEqual([last]);
    await retireDeniedGrant(family, owner.id);
    const completed = await pendingRetirements(family, owner.id);

    expect(Object.values(completed)).toStrictEqual([]);
    expect(upstream.retired).toHaveLength(3);
  });

  it('retires a pair that advanced between marker commit and current-pair resolution', async () => {
    const token = await seedRefreshToken();

    const record = required(
      await model.getRefreshToken(token),
      'refresh record',
    );

    const stored = required(
      await model.getStoredAccessToken(record.accessToken),
      'access record',
    );

    const next = {
      accessToken: `advanced-at-${randomUUID()}`,
      refreshToken: `advanced-rt-${randomUUID()}`,
    };

    const original = model.revokeGrant;

    const spy = vi
      .spyOn(model, 'revokeGrant')
      .mockImplementation(original)
      .mockImplementationOnce(async (id, clientId, options) => {
        await original(id, clientId, options);

        await getTokens().set(next.accessToken, { ...stored, ...next });
        await getRefreshTokens().set(next.refreshToken, {
          ...next,
          clientId: owner.id,
          grantFamilyId: id,
        });
        await getRefreshResults().set(
          token,
          {
            ...next,
            clientId: owner.id,
            grantFamilyId: id,
            expiresAt: Date.now() + 3_600_000,
          },
          60_000,
        );
      });

    try {
      await expect(revoke(owner, token)).resolves.toBe(200);
      expect(upstream.retired).toContainEqual(next);
      expect(upstream.retired).toContainEqual({
        accessToken: record.accessToken,
        refreshToken: token,
      });
      expectRejected(await refresh(owner, next.refreshToken));
    } finally {
      spy.mockRestore();
    }
  });
});

describe('legacy upgrade compatibility', () => {
  it('keeps an existing unbound bearer usable on its first request', async () => {
    const pairs = await seedLegacyChain(false);
    const { lookupOAuthToken } = await import('../transport/oauth-token');
    const { Effect, Option } = await import('effect');

    const result = await Effect.runPromise(
      lookupOAuthToken(pairs[3].accessToken),
    );

    expect(Option.isSome(result)).toBe(true);
    const bound = await model.getStoredAccessToken(pairs[3].accessToken);

    expect(
      z
        .object({ grantFamilyId: z.string().regex(/^[a-f0-9]{64}$/u) })
        .safeParse(bound).success,
    ).toBe(true);
  });

  it('refreshes an existing unbound current grant without requiring another login', async () => {
    const pairs = await seedLegacyChain(false);
    const result = await refresh(owner, pairs[3].refreshToken);

    expect(result.status).toBe(200);
    expect(result.body.refresh_token).toBeDefined();
    expect(result.body.access_token).toBeDefined();
    expect(upstream.calls).toBe(1);
  });

  it('recovers an existing wholly unbound cached chain on upgrade', async () => {
    const pairs = await seedLegacyChain(false);
    const result = await refresh(owner, pairs[0].refreshToken);

    expect(result.status).toBe(200);
    expect(pair(result.body)).toStrictEqual([
      pairs[1].accessToken,
      pairs[1].refreshToken,
    ]);
    expect(upstream.calls).toBe(0);
  });

  it('does not adopt a legacy bearer or cache when a reachable terminal alias was revoked', async () => {
    const pairs = await seedLegacyChain(false);
    const { accessGrantAlias } = await import('../oauth/grant-family');
    await model.revokeGrant(
      accessGrantAlias(owner.id, pairs[3].accessToken),
      owner.id,
    );

    await expect(
      model.getAccessToken(pairs[0].accessToken),
    ).resolves.toBeUndefined();
    expectRejected(await refresh(owner, pairs[0].refreshToken));
    expect(upstream.calls).toBe(0);
  });

  it('fails closed when legacy adoption cannot read the denial store', async () => {
    const pairs = await seedLegacyChain(false);

    const spy = vi
      .spyOn(model, 'isGrantRevoked')
      .mockRejectedValue(new Error('Fixture legacy denial read unavailable'));

    try {
      await expect(model.getAccessToken(pairs[3].accessToken)).rejects.toThrow(
        'Fixture legacy denial read unavailable',
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('does not bind a legacy grant for a different refresh client', async () => {
    const pairs = await seedLegacyChain(false);
    expectRejected(await refresh(other, pairs[3].refreshToken));
    const stored = await model.getStoredAccessToken(pairs[3].accessToken);

    expect(stored?.grantFamilyId).toBeUndefined();
    expect(upstream.calls).toBe(0);
  });
});
