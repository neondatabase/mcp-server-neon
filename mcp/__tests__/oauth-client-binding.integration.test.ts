// Actual token/revoke routes + actual Model. Only external storage/provider and telemetry are replaced.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Client } from 'oauth2-server';
import type { GrantContext } from '../utils/grant-context';
const state = vi.hoisted(() => ({
  tables: new Map<string, Map<string, unknown>>(),
  upstream: vi.fn(),
}));
function table(name: string) {
  let values = state.tables.get(name);
  if (!values) {
    values = new Map();
    state.tables.set(name, values);
  }
  return {
    get: async (key: string) => values.get(key),
    set: async (key: string, value: unknown) => {
      values.set(key, value);
      return true;
    },
    delete: async (key: string) => values.delete(key),
  };
}
vi.mock('../oauth/kv-store', () => ({
  getClients: () => table('clients'),
  getTokens: () => table('tokens'),
  getRefreshTokens: () => table('refresh'),
  getRefreshResults: () => table('results'),
  getRefreshFailures: () => table('failures'),
  getAuthorizationCodes: () => table('codes'),
  getClientRegisterHeaders: () => table('headers'),
  getApiKeys: () => table('apiKeys'),
}));
vi.mock('../../lib/oauth/client', () => ({
  exchangeRefreshToken: (...args: unknown[]) => state.upstream(...args),
}));
vi.mock('../analytics/analytics', () => ({
  identify: vi.fn(),
  track: vi.fn(),
  flushAnalytics: async () => {},
}));
vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }));
vi.mock('../server/api', () => ({
  createNeonClient: () => ({
    getAuthDetails: async () => ({
      data: { auth_method: 'oauth', account_id: 'synthetic-user-A' },
    }),
  }),
}));
const { model } = await import('../oauth/model');
const { POST: tokenPost } = await import('../../app/api/token/route');
const { POST: revokePost } = await import('../../app/api/revoke/route');
const flights = await import('../utils/singleflight');
const { __resetForTests, __setRefreshLockStoresForTests } =
  await import('../oauth/refresh-lock');
const grant: GrantContext = {
  projectId: 'own-project-A',
  scopes: ['querying'],
  roleName: 'own_reader',
};
const client = (id: string): Client => ({
  id,
  secret: 'synthetic-secret-' + id,
  tokenEndpointAuthMethod: 'client_secret_post',
  grants: ['refresh_token'],
});
async function refresh(
  id: string,
  rt = 'rt-A-0',
  secret = 'synthetic-secret-' + id,
) {
  return tokenPost(
    new NextRequest('http://127.0.0.1/api/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: id,
        client_secret: secret,
        refresh_token: rt,
      }).toString(),
    }),
  );
}
async function revoke(id: string, rt = 'rt-A-0') {
  return revokePost(
    new NextRequest('http://127.0.0.1/api/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: id,
        client_secret: 'synthetic-secret-' + id,
        token: rt,
        token_type_hint: 'refresh_token',
      }).toString(),
    }),
  );
}
const lock = {
  name: 'redis' as const,
  tryAcquire: async () => true,
  extend: async () => {},
  release: async () => {},
  isHeld: async () => false,
  markTransient: async () => {},
  hasTransient: async () => false,
};
beforeEach(async () => {
  state.tables.clear();
  state.upstream.mockReset();
  __resetForTests();
  delete process.env.OAUTH_DATABASE_URL;
  delete process.env.KV_URL;
  delete process.env.REDIS_URL;
  await model.saveClient(client('A'));
  await model.saveClient(client('B'));
  await model.saveToken({
    accessToken: 'at-A-0',
    refreshToken: 'rt-A-0',
    client: client('A'),
    user: { id: 'synthetic-user-A' },
    scope: 'read',
    grant,
    expires_at: Date.now() + 3600000,
  });
  await model.saveRefreshToken({
    refreshToken: 'rt-A-0',
    accessToken: 'at-A-0',
  });
  state.upstream.mockResolvedValue({
    access_token: 'at-A-1',
    refresh_token: 'rt-A-1',
    expiresIn: () => 3600,
  });
});
describe('refresh/revoke client authority', () => {
  it('legitimate rotation and same-client replay preserve actual stored grant', async () => {
    expect((await refresh('A')).status).toBe(200);
    expect((await model.getAccessToken('at-A-1'))?.grant).toEqual(grant);
    const replay = await refresh('A');
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      access_token: 'at-A-1',
      refresh_token: 'rt-A-1',
      scope: 'read',
    });
    expect(state.upstream).toHaveBeenCalledTimes(1);
  });
  it('rejects wrong client on the cold path before contacting upstream', async () => {
    const response = await refresh('B');
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_grant' });
    expect(state.upstream).not.toHaveBeenCalled();
  });
  it('rejects cross-client replay via error-cache fallback', async () => {
    expect((await refresh('A')).status).toBe(200);
    const response = await refresh('B');
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_grant' });
    expect(state.upstream).toHaveBeenCalledTimes(1);
  });
  it('rejects cross-client replay through an acquired lock cache hit', async () => {
    __setRefreshLockStoresForTests([lock]);
    expect((await refresh('A')).status).toBe(200);
    const response = await refresh('B');
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_grant' });
    expect(state.upstream).toHaveBeenCalledTimes(1);
  });
  it('a mismatched client must not poison the legitimate refresh failure cache', async () => {
    expect((await refresh('B')).status).toBe(400);
    const response = await refresh('A');
    expect(response.status).toBe(200);
    expect(state.upstream).toHaveBeenCalledTimes(1);
  });
  it('rejects bad client credentials even with a populated success cache', async () => {
    expect((await refresh('A')).status).toBe(200);
    const response = await refresh('B', 'rt-A-0', 'wrong-secret');
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_client' });
  });
  it('cross-client revocation leaves the owner refresh token usable', async () => {
    expect((await revoke('B')).status).toBe(200);
    expect(await model.getRefreshToken('rt-A-0')).toBeDefined();
    expect((await refresh('A')).status).toBe(200);
  });
  it('owner revocation removes token consumers and blocks subsequent refresh', async () => {
    expect((await revoke('A')).status).toBe(200);
    expect(await model.getRefreshToken('rt-A-0')).toBeUndefined();
    expect(await model.getAccessToken('at-A-0')).toBeUndefined();
    expect((await refresh('A')).status).toBe(400);
    expect(state.upstream).not.toHaveBeenCalled();
  });
});

describe('boundary and compatibility controls', () => {
  it('does not share an in-flight refresh result across different clients', async () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const ready = new Promise<void>((r) => {
      entered = r;
    });
    state.upstream.mockImplementation(async () => {
      entered();
      await gate;
      return {
        access_token: 'at-A-1',
        refresh_token: 'rt-A-1',
        expiresIn: () => 3600,
      };
    });
    let reachedSecond!: () => void;
    const secondEntry = new Promise<void>((r) => {
      reachedSecond = r;
    });
    const original = flights.singleflight;
    let entries = 0;
    const spy = vi
      .spyOn(flights, 'singleflight')
      .mockImplementation(<T>(key: string, fn: () => Promise<T>) => {
        const result = original<T>(key, fn);
        if (++entries === 2) reachedSecond();
        return result;
      });
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const a = refresh('A');
    await ready;
    const b = refresh('B');
    try {
      await Promise.race([
        secondEntry,
        new Promise<never>((_, reject) => {
          deadline = setTimeout(
            () =>
              reject(
                new Error(
                  'fixture barrier: second singleflight entry not observed',
                ),
              ),
            2000,
          );
        }),
      ]);
      expect(entries).toBe(2);
      release();
      const [ar, br] = await Promise.all([a, b]);
      expect(ar.status).toBe(200);
      expect(br.status).toBe(400);
      expect(state.upstream).toHaveBeenCalledTimes(1);
    } finally {
      release();
      if (deadline) clearTimeout(deadline);
      await Promise.allSettled([a, b]);
      spy.mockRestore();
    }
  });
  it('same-client third replay remains usable when the lock is unavailable', async () => {
    for (let attempt = 0; attempt < 3; attempt++)
      expect((await refresh('A')).status).toBe(200);
    expect(state.upstream).toHaveBeenCalledTimes(1);
  });
  it('legacy success-cache owner can replay while a different client cannot', async () => {
    await model.saveRefreshResult('rt-A-0', {
      accessToken: 'at-A-0',
      refreshToken: 'rt-A-0',
      expiresAt: Date.now() + 3600000,
      scope: 'read',
    });
    __setRefreshLockStoresForTests([lock]);
    expect((await refresh('A')).status).toBe(200);
    expect((await refresh('B')).status).toBe(400);
    expect(state.upstream).not.toHaveBeenCalled();
  });
  it('unowned legacy cache row never supplies credentials to another client', async () => {
    await model.saveRefreshResult('missing-rt', {
      accessToken: 'missing-at',
      refreshToken: 'other-missing-rt',
      expiresAt: Date.now() + 3600000,
    });
    __setRefreshLockStoresForTests([lock]);
    expect((await refresh('B', 'missing-rt')).status).toBe(400);
    expect(state.upstream).not.toHaveBeenCalled();
  });
});

describe('additional failure and lifecycle observations', () => {
  it('does not expose legacy cached credentials when owner lookup fails', async () => {
    await model.saveRefreshResult('rt-A-0', {
      accessToken: 'at-A-0',
      refreshToken: 'rt-A-0',
      expiresAt: Date.now() + 3600000,
    });
    __setRefreshLockStoresForTests([lock]);
    const spy = vi
      .spyOn(model, 'getAccessToken')
      .mockRejectedValueOnce(new Error('synthetic store outage'));
    try {
      expect((await refresh('B')).status).toBe(400);
      expect(state.upstream).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
  it('records stale cached credentials after owner revoke while the real MCP verifier denies them', async () => {
    const { POST: mcpPost } = await import('../../app/api/[transport]/route');
    async function listed() {
      return mcpPost(
        new Request('http://127.0.0.1/api/mcp', {
          method: 'POST',
          headers: {
            authorization: 'Bearer at-A-1',
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 91,
            method: 'tools/list',
          }),
        }),
      );
    }
    expect((await refresh('A')).status).toBe(200);
    const positive = await listed();
    expect(positive.status).toBe(200);
    const raw = await positive.text();
    const data = raw
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .at(-1);
    const positiveRpc = JSON.parse(data ? data.slice(6) : raw);
    expect(positiveRpc.error).toBeUndefined();
    expect(
      positiveRpc.result.tools.map((tool: { name: string }) => tool.name),
    ).toContain('run_sql');
    expect((await revoke('A', 'rt-A-1')).status).toBe(200);
    const replay = await refresh('A');
    const body = await replay.json();
    const denied = await listed();
    await denied.text();
    // Characterization of an explicitly uncorrected lifecycle limit, not a claim that replay is safe.
    expect(replay.status).toBe(200);
    expect(body.access_token).toBe('at-A-1');
    expect(await model.getAccessToken('at-A-1')).toBeUndefined();
    expect(await model.getRefreshToken('rt-A-1')).toBeUndefined();
    expect(denied.status).toBe(401);
  });
});

describe('legacy owner recovery before lifecycle deployment', () => {
  async function legacyPairRotations() {
    expect((await refresh('A')).status).toBe(200);
    state.upstream.mockResolvedValue({
      access_token: 'at-A-2',
      refresh_token: 'rt-A-2',
      expiresIn: () => 3600,
    });
    expect((await refresh('A', 'rt-A-1')).status).toBe(200);
    const values = state.tables.get('results')!;
    for (const [key, value] of values) {
      const row = { ...(value as Record<string, unknown>) };
      delete row.clientId;
      delete row.grantFamilyId;
      values.set(key, row);
    }
  }
  it('a client with an older legacy RT follows cached successors without contacting upstream again', async () => {
    await legacyPairRotations();
    const calls = state.upstream.mock.calls.length;
    const before = JSON.stringify([...state.tables.get('results')!.entries()]);
    const writer = vi.spyOn(model, 'saveRefreshResult');
    try {
      const response = await refresh('A', 'rt-A-0');
      expect(response.status).toBe(200);
      expect((await response.json()).refresh_token).toBe('rt-A-1');
      expect(state.upstream).toHaveBeenCalledTimes(calls);
      expect(writer).not.toHaveBeenCalled();
      expect(JSON.stringify([...state.tables.get('results')!.entries()])).toBe(
        before,
      );
    } finally {
      writer.mockRestore();
    }
  });
  it('foreign legacy replay is denied without poisoning the legitimate owner', async () => {
    await legacyPairRotations();
    expect((await refresh('B', 'rt-A-0')).status).toBe(400);
    expect((await refresh('A', 'rt-A-0')).status).toBe(200);
    expect(state.upstream).toHaveBeenCalledTimes(2);
  });
  it('a fully client-bound cache descendant can establish an owner after token persistence was lost', async () => {
    await legacyPairRotations();
    const rows = state.tables.get('results')!;
    rows.set('rt-A-1', {
      ...(rows.get('rt-A-1') as Record<string, unknown>),
      clientId: 'A',
    });
    state.tables.get('tokens')!.delete('at-A-2');
    expect((await refresh('A', 'rt-A-0')).status).toBe(200);
    expect((await refresh('B', 'rt-A-0')).status).toBe(400);
  });
  it('a legacy cycle without an owner never supplies cached credentials', async () => {
    await legacyPairRotations();
    const rows = state.tables.get('results')!;
    rows.set('rt-A-1', {
      ...(rows.get('rt-A-1') as Record<string, unknown>),
      accessToken: 'missing',
      refreshToken: 'rt-A-0',
    });
    expect((await refresh('A', 'rt-A-0')).status).toBe(400);
    expect(state.upstream).toHaveBeenCalledTimes(2);
  });
});
