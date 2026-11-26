/**
 * Concurrency / race-coverage tests for the refresh-token rotation flow.
 *
 * The production failure mode we're guarding against is concurrent requests
 * with the same refresh_token all forwarding to upstream Hydra — Hydra
 * detects refresh-token reuse and revokes the entire chain. This file covers
 * one instance, whose requests the same-instance dedup absorbs;
 * refresh-rotation.integration.test.ts covers several instances sharing the
 * Postgres lock. It simulates the race by:
 *
 *   1. Mocking `model` with a shared in-memory store standing in for
 *      Postgres (refresh_tokens, tokens, refresh_results, refresh_failures).
 *   2. Mocking `exchangeRefreshToken` with a configurable latency so
 *      concurrent requests have a realistic window in which to race.
 *
 * The success criterion: N concurrent requests with the same RT result in
 *   - exactly **1** upstream call,
 *   - **N** successful 200 responses,
 *   - **0** chain-revoking errors.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────
// Shared simulated state (one Postgres, one upstream counter)
// ─────────────────────────────────────────────────────────────────────────

type Token = {
  accessToken: string;
  refreshToken: string;
  expires_at: number;
  client: { id: string; client_name?: string };
  user: { id: string; name?: string; email?: string };
  scope: string;
  grant?: unknown;
};
type RefreshTokenRecord = { refreshToken: string; accessToken: string };

type BenchState = {
  refreshTokens: Map<string, RefreshTokenRecord>;
  tokens: Map<string, Token>;
  refreshResults: Map<
    string,
    {
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
      scope?: string | string[];
    }
  >;
  refreshFailures: Map<
    string,
    {
      failedAt: number;
      oauthError?: string;
      oauthErrorDescription?: string;
    }
  >;
  upstreamCalls: number;
  upstreamLatencyMs: number;
};

const state: BenchState = {
  refreshTokens: new Map(),
  tokens: new Map(),
  refreshResults: new Map(),
  refreshFailures: new Map(),
  upstreamCalls: 0,
  upstreamLatencyMs: 50,
};

function resetState(): void {
  state.refreshTokens.clear();
  state.tokens.clear();
  state.refreshResults.clear();
  state.refreshFailures.clear();
  state.upstreamCalls = 0;
  state.upstreamLatencyMs = 50;
}

// ─────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────

vi.mock('../oauth/model', () => ({
  model: {
    getClient: async (id: string) =>
      id === TEST_CLIENT.id ? TEST_CLIENT : undefined,
    getRefreshToken: async (rt: string) => state.refreshTokens.get(rt),
    getAccessToken: async (at: string) => state.tokens.get(at),
    saveToken: async (token: Token) => {
      state.tokens.set(token.accessToken, token);
      return token;
    },
    saveRefreshToken: async (record: RefreshTokenRecord) => {
      state.refreshTokens.set(record.refreshToken, record);
      return record;
    },
    deleteToken: async (token: Token) => state.tokens.delete(token.accessToken),
    deleteRefreshToken: async (record: RefreshTokenRecord) =>
      state.refreshTokens.delete(record.refreshToken),
    saveRefreshResult: async (
      rt: string,
      result: {
        accessToken: string;
        refreshToken: string;
        expiresAt: number;
        scope?: string | string[];
      },
    ) => {
      state.refreshResults.set(rt, result);
    },
    getRefreshResult: async (rt: string) => state.refreshResults.get(rt),
    // Every rotation in this suite is replayed within the grace period.
    getRefreshRotation: async (rt: string) => {
      const result = state.refreshResults.get(rt);

      return result && { result, rotatedAt: Date.now() };
    },
    saveRefreshFailure: async (
      rt: string,
      detail: {
        failedAt: number;
        oauthError?: string;
        oauthErrorDescription?: string;
      },
    ) => {
      state.refreshFailures.set(rt, detail);
    },
    getRefreshFailure: async (rt: string) => state.refreshFailures.get(rt),
  },
}));

vi.mock('../../lib/oauth/client', () => ({
  exchangeRefreshToken: async (rt: string) => {
    state.upstreamCalls++;
    if (state.upstreamLatencyMs > 0) {
      await new Promise<void>((r) => {
        const t = setTimeout(r, state.upstreamLatencyMs);
        t.unref?.();
      });
    }
    const issuance = state.upstreamCalls;
    return {
      access_token: `at-${rt}-${issuance}`,
      refresh_token: `${rt}-rotated-${issuance}`,
      expiresIn: () => 3600,
      scope: 'read write',
    };
  },
}));

vi.mock('../oauth/utils', () => ({
  verifyPKCE: vi.fn().mockReturnValue(true),
}));

vi.mock('../analytics/analytics', () => ({
  identify: vi.fn(),
  flushAnalytics: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@vercel/functions', () => ({
  waitUntil: vi.fn(),
}));

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { POST } from '../../app/api/token/route';
import { __resetForTests } from '../oauth/refresh-lock';
import { NextRequest } from 'next/server';

const TEST_CLIENT = {
  id: 'client-1',
  secret: 'secret-1',
  grants: ['refresh_token'],
  redirect_uris: ['http://localhost/callback'],
  client_name: 'Test Client',
  tokenEndpointAuthMethod: 'client_secret_post',
};

function makeRequest(refreshToken: string): NextRequest {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: TEST_CLIENT.id,
    client_secret: TEST_CLIENT.secret,
  });
  return new NextRequest('http://localhost/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
}

function seedToken(refreshToken: string): void {
  const accessToken = `at-old-${refreshToken}`;
  state.refreshTokens.set(refreshToken, { refreshToken, accessToken });
  state.tokens.set(accessToken, {
    accessToken,
    refreshToken,
    expires_at: Date.now() + 3600_000,
    client: TEST_CLIENT,
    user: { id: `user-${refreshToken}`, name: 'U', email: 'u@example.com' },
    scope: 'read write',
  });
}

function pct(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

beforeEach(() => {
  resetState();
  __resetForTests();
  delete process.env.OAUTH_DATABASE_URL;
});

// ─────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────

describe('Concurrent refresh — race coverage', () => {
  it('100 concurrent requests with the SAME refresh_token → 1 upstream call, 100 successes', async () => {
    seedToken('rt-shared');

    const N = 100;
    const start = Date.now();
    const responses = await Promise.all(
      Array.from({ length: N }, () => POST(makeRequest('rt-shared'))),
    );
    const elapsed = Date.now() - start;

    const successes = responses.filter((r) => r.status === 200);
    const failures = responses.filter((r) => r.status !== 200);

    // Surface stats so a human running the test sees the bench dimensions.
    console.log(
      `[bench] same-RT  N=${N}  upstream=${state.upstreamCalls}  ` +
        `success=${successes.length}/${N}  ` +
        `elapsed=${elapsed}ms (${(N / (elapsed / 1000)).toFixed(0)} req/s)`,
    );
    if (failures.length > 0) {
      const samples = await Promise.all(
        failures.slice(0, 3).map((r) => r.text()),
      );
      console.log(`[bench] failure samples:`, samples);
    }

    expect(successes.length).toBe(N);
    expect(state.upstreamCalls).toBe(1);

    // All bodies should carry the same rotated refresh_token (the 1 issued
    // by the lock holder, replayed from cache to the other 99 callers).
    const bodies = await Promise.all(successes.map((r) => r.json()));
    const distinctNewRTs = new Set(
      bodies.map((b: { refresh_token: string }) => b.refresh_token),
    );
    expect(distinctNewRTs.size).toBe(1);
    expect([...distinctNewRTs][0]).toContain('rt-shared-rotated');
  });

  it('500 concurrent requests with the SAME refresh_token still = 1 upstream call', async () => {
    seedToken('rt-shared');
    state.upstreamLatencyMs = 100; // wider race window

    const N = 500;
    const start = Date.now();
    const responses = await Promise.all(
      Array.from({ length: N }, () => POST(makeRequest('rt-shared'))),
    );
    const elapsed = Date.now() - start;

    const successes = responses.filter((r) => r.status === 200);

    console.log(
      `[bench] same-RT  N=${N}  upstream=${state.upstreamCalls}  ` +
        `success=${successes.length}/${N}  elapsed=${elapsed}ms`,
    );

    expect(successes.length).toBe(N);
    expect(state.upstreamCalls).toBe(1);
  }, 30_000);

  it('200 concurrent requests with 50 DISTINCT refresh_tokens → 50 upstream calls, 200 successes', async () => {
    const distinctRTs = 50;
    const requestsPerRT = 4; // → 200 total
    const tokens = Array.from({ length: distinctRTs }, (_, i) => `rt-${i}`);
    tokens.forEach(seedToken);

    const requests = tokens.flatMap((rt) =>
      Array.from({ length: requestsPerRT }, () => POST(makeRequest(rt))),
    );

    const start = Date.now();
    const responses = await Promise.all(requests);
    const elapsed = Date.now() - start;

    const successes = responses.filter((r) => r.status === 200);

    console.log(
      `[bench] distinct-RTs  RTs=${distinctRTs} reqs/RT=${requestsPerRT} ` +
        `total=${requests.length}  upstream=${state.upstreamCalls}  ` +
        `success=${successes.length}/${requests.length}  elapsed=${elapsed}ms`,
    );

    expect(successes.length).toBe(requests.length);
    expect(state.upstreamCalls).toBe(distinctRTs);
  });

  it('stale RT presented after rotation → 0 upstream calls (cache hit)', async () => {
    seedToken('rt-stale');
    // First refresh succeeds, populates cache, deletes the RT row.
    const first = await POST(makeRequest('rt-stale'));
    expect(first.status).toBe(200);
    expect(state.upstreamCalls).toBe(1);

    // Same RT presented again (e.g. laptop wake, tab restore) — should
    // hit the success cache without touching upstream.
    const upstreamBefore = state.upstreamCalls;
    const N = 20;
    const responses = await Promise.all(
      Array.from({ length: N }, () => POST(makeRequest('rt-stale'))),
    );
    const successes = responses.filter((r) => r.status === 200);

    console.log(
      `[bench] stale-RT replay  N=${N}  upstream=${state.upstreamCalls - upstreamBefore} ` +
        `(${state.upstreamCalls} total)  success=${successes.length}/${N}`,
    );

    expect(successes.length).toBe(N);
    expect(state.upstreamCalls).toBe(upstreamBefore);
  });

  it('latency distribution under contention: p50 close to upstream latency, p99 < 1s for waiters', async () => {
    seedToken('rt-shared');
    state.upstreamLatencyMs = 200;

    const N = 100;
    const latencies: number[] = [];
    const responses = await Promise.all(
      Array.from({ length: N }, async () => {
        const t0 = Date.now();
        const r = await POST(makeRequest('rt-shared'));
        latencies.push(Date.now() - t0);
        return r;
      }),
    );

    const successes = responses.filter((r) => r.status === 200);
    const p50 = pct(latencies, 0.5);
    const p95 = pct(latencies, 0.95);
    const p99 = pct(latencies, 0.99);

    console.log(
      `[bench] latency under contention  N=${N}  upstream=${state.upstreamCalls}  ` +
        `p50=${p50}ms p95=${p95}ms p99=${p99}ms`,
    );

    expect(successes.length).toBe(N);
    expect(state.upstreamCalls).toBe(1);
    // p99 must be reasonable — waiters poll every 100ms, so worst case is
    // upstream latency + one poll interval + slack. Way under the 5s lock
    // timeout in any healthy run.
    expect(p99).toBeLessThan(1_000);
  });

  it('holder bails pre-upstream → waiters get 400 invalid_grant, not 503', async () => {
    // Don't seed the RT — first arrival becomes the holder, hits
    // "Refresh token not found in storage", caches the failure, and
    // throws RefreshError before upstream. With the pre-upstream-failure
    // cache fix, waiters peek the failure cache on their next poll and
    // surface 400 instead of timing out to 503.
    const N = 30;
    const responses = await Promise.all(
      Array.from({ length: N }, () => POST(makeRequest('rt-never-stored'))),
    );

    const statuses = responses.map((r) => r.status);
    const codes = statuses.reduce(
      (acc, s) => {
        acc[s] = (acc[s] ?? 0) + 1;
        return acc;
      },
      {} as Record<number, number>,
    );

    console.log(
      `[bench] pre-upstream bail  N=${N}  upstream=${state.upstreamCalls}  ` +
        `statuses=${JSON.stringify(codes)}`,
    );

    expect(state.upstreamCalls).toBe(0);
    // The whole population should land on 400, none on 503.
    expect(codes[400]).toBe(N);
    expect(codes[503] ?? 0).toBe(0);

    // Body should carry invalid_grant, not temporarily_unavailable.
    const bodies = await Promise.all(responses.map((r) => r.json()));
    const errors = new Set(bodies.map((b: { error: string }) => b.error));
    expect(errors.size).toBe(1);
    expect([...errors][0]).toBe('invalid_grant');
  });
});
