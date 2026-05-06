/**
 * Concurrency / race-coverage tests for the refresh-token rotation flow.
 *
 * The production failure mode we're guarding against is two Vercel instances
 * receiving requests with the same refresh_token within milliseconds and both
 * forwarding to upstream Hydra — Hydra detects refresh-token reuse and
 * revokes the entire chain. This file simulates that by:
 *
 *   1. Replacing the in-memory `singleflight` with a passthrough — that
 *      module dedups within one instance, so leaving it in would mask the
 *      cross-instance behavior we want to test.
 *   2. Mocking `redis` with a shared in-memory store so all concurrent
 *      callers see the same lock state (as they would in production).
 *   3. Mocking `model` with a shared in-memory store standing in for
 *      Postgres (refresh_tokens, tokens, refresh_results, refresh_failures).
 *   4. Mocking `exchangeRefreshToken` with a configurable latency so
 *      concurrent requests have a realistic window in which to race.
 *
 * The success criterion: N concurrent requests with the same RT result in
 *   - exactly **1** upstream call,
 *   - **N** successful 200 responses,
 *   - **0** chain-revoking errors.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────
// Shared simulated state (one Redis, one Postgres, one upstream counter)
// ─────────────────────────────────────────────────────────────────────────

type RedisEntry = { value: string; expiresAt?: number };
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
  redis: Map<string, RedisEntry>;
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
  redis: new Map(),
  refreshTokens: new Map(),
  tokens: new Map(),
  refreshResults: new Map(),
  refreshFailures: new Map(),
  upstreamCalls: 0,
  upstreamLatencyMs: 50,
};

function resetState(): void {
  state.redis.clear();
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

// Redis: SET (NX/PX), GET, EVAL (compare-and-delete). The bodies are
// synchronous JS — no internal awaits — so each call runs to completion
// atomically in the microtask queue, matching real Redis atomicity for
// these single-key ops.
vi.mock('redis', () => {
  const createRedisMock = () => ({
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    set: async (
      key: string,
      value: string,
      opts?: { NX?: boolean; PX?: number },
    ): Promise<string | null> => {
      const now = Date.now();
      const existing = state.redis.get(key);
      const expired =
        existing?.expiresAt !== undefined && existing.expiresAt <= now;
      if (opts?.NX && existing && !expired) return null;
      const expiresAt = opts?.PX ? now + opts.PX : undefined;
      state.redis.set(key, { value, expiresAt });
      return 'OK';
    },
    get: async (key: string): Promise<string | null> => {
      const entry = state.redis.get(key);
      if (!entry) return null;
      if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
        state.redis.delete(key);
        return null;
      }
      return entry.value;
    },
    eval: async (
      _script: string,
      opts: { keys: string[]; arguments: string[] },
    ): Promise<number> => {
      const key = opts.keys[0];
      const expected = opts.arguments[0];
      const entry = state.redis.get(key);
      if (entry?.value === expected) {
        state.redis.delete(key);
        return 1;
      }
      return 0;
    },
  });
  return { createClient: vi.fn(() => createRedisMock()) };
});

// Passthrough singleflight — bypasses same-instance dedup so the lock has
// to do the work, simulating cross-instance behavior.
vi.mock('../utils/singleflight', () => ({
  singleflight: async <T>(_key: string, fn: () => Promise<T>): Promise<T> =>
    fn(),
}));

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

vi.mock('../../lib/errors', () => ({
  handleOAuthError: vi.fn(
    () =>
      new Response(JSON.stringify({ error: 'server_error' }), { status: 500 }),
  ),
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
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

type RouteHandler = typeof POST;

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
  process.env.KV_URL = 'redis://test';
});

afterEach(() => {
  delete process.env.KV_URL;
  delete process.env.REDIS_URL;
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
});

// ─────────────────────────────────────────────────────────────────────────
// Multi-listener bench: simulates N independent Vercel instances by giving
// each one its own module graph (own singleflight Map, own redis-client
// memoization in refresh-lock.ts), exposed via real HTTP on distinct ports.
// They share only the mock Redis backing state and the mock Postgres model
// state — same as production where multiple Vercel instances share one
// Upstash Redis and one Postgres.
// ─────────────────────────────────────────────────────────────────────────

async function loadIsolatedHandler(): Promise<RouteHandler> {
  // Reset module registry so the next dynamic import gives us a fresh graph.
  // The vi.mock() factories above are hoisted and persist across resets, and
  // the shared `state` object lives at this test file's top level, so the
  // mocks of redis/model/upstream still resolve to the same backing data —
  // exactly the topology we want to simulate.
  vi.resetModules();
  const mod = await import('../../app/api/token/route');
  return mod.POST;
}

type Listener = { server: Server; port: number };

async function spawnListener(handler: RouteHandler): Promise<Listener> {
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = Buffer.concat(chunks);
      // node http types lowercase headers; cast to satisfy NextRequest's init.
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers.set(k, v);
        else if (Array.isArray(v)) headers.set(k, v.join(','));
      }
      const nextReq = new NextRequest(`http://localhost${req.url ?? '/'}`, {
        method: req.method,
        headers,
        body: body.length > 0 ? body : undefined,
      });
      const response = await handler(nextReq);
      const respBody = await response.text();
      const respHeaders: Record<string, string> = {};
      response.headers.forEach((v, k) => {
        respHeaders[k] = v;
      });
      res.writeHead(response.status, respHeaders);
      res.end(respBody);
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(err) }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address() as AddressInfo;
  return { server, port: addr.port };
}

async function closeListener(l: Listener): Promise<void> {
  await new Promise<void>((resolve) => l.server.close(() => resolve()));
}

describe('Distributed lock across real HTTP listeners', () => {
  it('5 listeners on distinct ports → 1 upstream call from 100 round-robin requests', async () => {
    seedToken('rt-shared');
    state.upstreamLatencyMs = 100;

    // Spin up 5 listeners, each backed by its own isolated route-handler
    // module graph (own singleflight Map, own redis client memo).
    const listeners: Listener[] = [];
    for (let i = 0; i < 5; i++) {
      const handler = await loadIsolatedHandler();
      listeners.push(await spawnListener(handler));
    }

    try {
      const N = 100;
      const start = Date.now();
      const results = await Promise.all(
        Array.from({ length: N }, async (_, i) => {
          const port = listeners[i % listeners.length].port;
          const body = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: 'rt-shared',
            client_id: TEST_CLIENT.id,
            client_secret: TEST_CLIENT.secret,
          });
          const r = await fetch(`http://127.0.0.1:${port}/api/token`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
          });
          const text = await r.text();
          return {
            status: r.status,
            body: text,
            listenerIdx: i % listeners.length,
          };
        }),
      );
      const elapsed = Date.now() - start;

      const successes = results.filter((r) => r.status === 200);
      const failures = results.filter((r) => r.status !== 200);
      const distinctListenersHit = new Set(successes.map((r) => r.listenerIdx))
        .size;
      const distinctRTs = new Set(
        successes.map(
          (r) =>
            (JSON.parse(r.body) as { refresh_token: string }).refresh_token,
        ),
      );

      console.log(
        `[bench] multi-listener  listeners=${listeners.length}  N=${N}  ` +
          `upstream=${state.upstreamCalls}  success=${successes.length}/${N}  ` +
          `distinctListenersHit=${distinctListenersHit}  distinctNewRTs=${distinctRTs.size}  ` +
          `elapsed=${elapsed}ms`,
      );
      if (failures.length > 0) {
        console.log(`[bench] multi-listener failures:`, failures.slice(0, 3));
      }

      // The point of the test: every listener's request succeeded, but only
      // one of them actually called upstream — proving the lock serialised
      // across module-isolated handler instances coordinating through the
      // shared (mock) Redis.
      expect(successes.length).toBe(N);
      expect(state.upstreamCalls).toBe(1);
      expect(distinctListenersHit).toBe(listeners.length); // load was actually distributed
      expect(distinctRTs.size).toBe(1); // every caller got the same rotated RT
    } finally {
      await Promise.all(listeners.map(closeListener));
    }
  }, 30_000);

  it('10 listeners with distinct refresh_tokens → 1 upstream call per RT, no cross-token contention', async () => {
    const numListeners = 10;
    const numTokens = 10;
    const reqsPerToken = 5; // 50 total requests
    const tokens = Array.from({ length: numTokens }, (_, i) => `rt-multi-${i}`);
    tokens.forEach(seedToken);
    state.upstreamLatencyMs = 50;

    const listeners: Listener[] = [];
    for (let i = 0; i < numListeners; i++) {
      const handler = await loadIsolatedHandler();
      listeners.push(await spawnListener(handler));
    }

    try {
      // Every (token, repetition) pair fires at a randomly-chosen listener.
      const requests = tokens.flatMap((rt) =>
        Array.from({ length: reqsPerToken }, () => ({
          rt,
          listener: listeners[Math.floor(Math.random() * listeners.length)],
        })),
      );

      const start = Date.now();
      const results = await Promise.all(
        requests.map(async ({ rt, listener }) => {
          const body = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: rt,
            client_id: TEST_CLIENT.id,
            client_secret: TEST_CLIENT.secret,
          });
          const r = await fetch(`http://127.0.0.1:${listener.port}/api/token`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
          });
          return { rt, status: r.status };
        }),
      );
      const elapsed = Date.now() - start;
      const successes = results.filter((r) => r.status === 200);

      console.log(
        `[bench] multi-listener+multi-RT  listeners=${numListeners}  ` +
          `tokens=${numTokens} reqs/token=${reqsPerToken} total=${requests.length}  ` +
          `upstream=${state.upstreamCalls}  success=${successes.length}/${requests.length}  ` +
          `elapsed=${elapsed}ms`,
      );

      expect(successes.length).toBe(requests.length);
      expect(state.upstreamCalls).toBe(numTokens); // exactly one per RT
    } finally {
      await Promise.all(listeners.map(closeListener));
    }
  }, 30_000);
});
