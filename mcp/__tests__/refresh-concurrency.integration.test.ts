/**
 * Concurrency / race coverage for the refresh-token rotation flow.
 *
 * The production failure mode guarded against: two Vercel instances receive
 * requests with the same refresh_token within milliseconds and both forward
 * it to upstream Hydra, which detects the reuse and revokes the entire chain.
 * These tests fire concurrent POST /api/token requests at the real OAuth
 * Postgres store, refresh caches, and Postgres refresh lock, with a local
 * HTTPS stand-in for Hydra that answers after a configurable latency.
 *
 * Only the 'Distributed lock across real HTTP listeners' group exercises the
 * shared Postgres lock: each listener is its own instance. In the
 * single-instance group, concurrent requests are absorbed by RefreshInflight
 * and the refresh caches, so those cases hold even without the lock.
 *
 * The success criterion: N concurrent requests with the same RT result in
 *   - exactly **1** upstream call,
 *   - **N** successful 200 responses,
 *   - **0** chain-revoking errors.
 */
import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { Effect } from 'effect';
import { HttpRouter } from 'effect/http';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { readBody, startHydraStandIn } from './helpers/hydra-stand-in';

// The stand-in serves a throwaway self-signed certificate.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

process.env.CLIENT_ID = 'refresh-concurrency-upstream-client';

process.env.CLIENT_SECRET = 'refresh-concurrency-upstream-secret';

// Dozens of concurrent requests per test; their info lines would bury a failure.
process.env.LOG_LEVEL = 'warn';

delete process.env.KV_URL;

delete process.env.REDIS_URL;

const upstream = { calls: 0, latencyMs: 50 };

const hydra = await startHydraStandIn(async ({ refreshToken }) => {
  upstream.calls += 1;

  const issuance = upstream.calls;

  await sleep(upstream.latencyMs);

  return {
    kind: 'json',
    status: 200,
    body: {
      access_token: `at-${refreshToken}-${issuance}`,
      refresh_token: `${refreshToken}-rotated-${issuance}`,
      token_type: 'bearer',
      expires_in: 3600,
      scope: 'read write',
    },
  };
});

process.env.UPSTREAM_OAUTH_HOST = hydra.issuer;

// Imported once the environment above is set: lib/config reads it on load.
const { OAuthTestApp } = await import('./helpers/oauth-app');
const { OAuthStore } = await import('../oauth/oauth-store');

type StoreOperations = typeof OAuthStore.Service;

const handlers: { readonly dispose: () => Promise<void> }[] = [];

/** One server instance: its own refresh dedup, the shared database. */
const instance = () => {
  const handler = HttpRouter.toWebHandler(OAuthTestApp, {
    disableLogger: true,
  });

  handlers.push(handler);

  return handler;
};

const app = instance();

const onStore = async <A, E>(
  run: (operations: StoreOperations) => Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    OAuthStore.pipe(Effect.flatMap(run), Effect.provide(OAuthStore.layer)),
  );

const client = {
  id: `refresh-concurrency-${crypto.randomUUID()}`,
  secret: 'secret-1',
  grants: ['refresh_token'],
  redirect_uris: ['http://localhost/callback'],
  client_name: 'Test Client',
  tokenEndpointAuthMethod: 'client_secret_post',
};

await onStore((operations) =>
  operations.saveClient({ client, registerHeaders: {} }),
);

const uniqueToken = (name: string) => `${name}-${crypto.randomUUID()}`;

const seedToken = async (refreshToken: string) =>
  onStore((operations) =>
    operations.saveTokenPair({
      token: {
        accessToken: `at-old-${refreshToken}`,
        refreshToken,
        expires_at: Date.now() + 3_600_000,
        client,
        user: { id: `user-${refreshToken}`, name: 'U', email: 'u@example.com' },
        scope: 'read write',
      },
      refreshToken,
    }),
  );

const formBody = (refreshToken: string) =>
  new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: client.id,
    client_secret: client.secret,
  }).toString();

const refresh = async (refreshToken: string) =>
  app.handler(
    new Request('http://localhost/api/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody(refreshToken),
    }),
  );

const upstreamCallsFor = (refreshToken: string) =>
  hydra.requests.filter((request) => request.refreshToken === refreshToken)
    .length;

const RotatedPair = z.object({ refresh_token: z.string() });

const OAuthErrorBody = z.object({ error: z.string() });

const pct = (values: number[], p: number): number => {
  const sorted = values.toSorted((a, b) => a - b);

  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
  );
};

// Simulates independent Vercel instances: each listener runs its own web
// handler (its own same-instance refresh dedup) on a distinct port, and all
// of them share the OAuth database and its refresh lock, as production
// instances do.

const forward = async (
  handler: ReturnType<typeof instance>,
  request: IncomingMessage,
  response: ServerResponse,
) => {
  const answer = await handler.handler(
    new Request(`http://localhost${request.url ?? '/'}`, {
      method: request.method,
      headers: { 'content-type': request.headers['content-type'] ?? '' },
      body: await readBody(request),
    }),
  );

  response.writeHead(answer.status, Object.fromEntries(answer.headers));
  response.end(await answer.text());
};

const spawnListener = async () => {
  const handler = instance();

  const server = createServer((request, response) => {
    void forward(handler, request, response);
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const { port } = z.object({ port: z.number() }).parse(server.address());

  return {
    port,
    close: async () => {
      server.close();
      await once(server, 'close');
    },
  };
};

type Listener = Awaited<ReturnType<typeof spawnListener>>;

const refreshVia = async (listener: Listener, refreshToken: string) => {
  const response = await fetch(`http://127.0.0.1:${listener.port}/api/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody(refreshToken),
  });

  return { status: response.status, body: await response.text() };
};

const listenerAt = (listeners: readonly Listener[], index: number) => {
  const listener = listeners[index];

  if (listener === undefined) {
    throw new RangeError(`No listener ${index} of ${listeners.length}`);
  }

  return listener;
};

const spawnListeners = async (count: number) =>
  Promise.all(Array.from({ length: count }, async () => spawnListener()));

describe('Refresh concurrency', () => {
  afterAll(async () => {
    await Promise.all(handlers.map(async (handler) => handler.dispose()));
    await hydra.close();
  });

  describe('Concurrent refresh — race coverage', () => {
    it('25 concurrent requests with the SAME refresh_token → 1 upstream call, 25 successes', async () => {
      const refreshToken = uniqueToken('rt-shared');
      await seedToken(refreshToken);
      upstream.latencyMs = 50;

      const N = 25;
      const start = Date.now();

      const responses = await Promise.all(
        Array.from({ length: N }, async () => refresh(refreshToken)),
      );

      const elapsed = Date.now() - start;
      const successes = responses.filter(({ status }) => status === 200);

      // Bench dimensions for a human reading the run.
      console.log(
        `[bench] same-RT  N=${N}  upstream=${upstreamCallsFor(refreshToken)}  ` +
          `success=${successes.length}/${N}  elapsed=${elapsed}ms`,
      );

      expect(successes).toHaveLength(N);
      expect(upstreamCallsFor(refreshToken)).toBe(1);

      // Every caller gets the one pair the lock holder was issued.
      const bodies = await Promise.all(
        successes.map(async (response) =>
          RotatedPair.parse(await response.json()),
        ),
      );

      const distinctNewRTs = new Set(bodies.map((body) => body.refresh_token));

      expect(distinctNewRTs.size).toBe(1);
      expect([...distinctNewRTs][0]).toContain(`${refreshToken}-rotated`);
    }, 30_000);

    it('50 concurrent requests with the SAME refresh_token (the largest same-token case) still = 1 upstream call', async () => {
      const refreshToken = uniqueToken('rt-shared');
      await seedToken(refreshToken);
      upstream.latencyMs = 100;

      const N = 50;
      const start = Date.now();

      const responses = await Promise.all(
        Array.from({ length: N }, async () => refresh(refreshToken)),
      );

      const elapsed = Date.now() - start;
      const successes = responses.filter(({ status }) => status === 200);

      console.log(
        `[bench] same-RT  N=${N}  upstream=${upstreamCallsFor(refreshToken)}  ` +
          `success=${successes.length}/${N}  elapsed=${elapsed}ms`,
      );

      expect(successes).toHaveLength(N);
      expect(upstreamCallsFor(refreshToken)).toBe(1);
    }, 60_000);

    it('40 concurrent requests with 10 DISTINCT refresh_tokens → 10 upstream calls, 40 successes', async () => {
      const distinctRTs = 10;
      const requestsPerRT = 4;

      const tokens = Array.from({ length: distinctRTs }, (_, i) =>
        uniqueToken(`rt-${i}`),
      );

      await Promise.all(
        tokens.map(async (refreshToken) => seedToken(refreshToken)),
      );
      upstream.latencyMs = 50;

      const start = Date.now();

      const responses = await Promise.all(
        tokens.flatMap((refreshToken) =>
          Array.from({ length: requestsPerRT }, async () =>
            refresh(refreshToken),
          ),
        ),
      );

      const elapsed = Date.now() - start;
      const successes = responses.filter(({ status }) => status === 200);

      const calls = tokens.map((refreshToken) =>
        upstreamCallsFor(refreshToken),
      );

      console.log(
        `[bench] distinct-RTs  RTs=${distinctRTs} reqs/RT=${requestsPerRT} ` +
          `total=${responses.length}  success=${successes.length}/${responses.length}  ` +
          `elapsed=${elapsed}ms`,
      );

      expect(successes).toHaveLength(responses.length);
      expect(calls).toStrictEqual(tokens.map(() => 1));
    }, 30_000);

    it('stale RT presented after rotation → 0 upstream calls (cache hit)', async () => {
      const refreshToken = uniqueToken('rt-stale');
      await seedToken(refreshToken);
      upstream.latencyMs = 50;

      // The first refresh rotates the token and caches the new pair.
      const first = await refresh(refreshToken);

      expect(first.status).toBe(200);
      expect(upstreamCallsFor(refreshToken)).toBe(1);

      // The same RT again (laptop wake, tab restore) hits the success cache.
      const N = 20;

      const responses = await Promise.all(
        Array.from({ length: N }, async () => refresh(refreshToken)),
      );

      const successes = responses.filter(({ status }) => status === 200);

      console.log(
        `[bench] stale-RT replay  N=${N}  upstream=${upstreamCallsFor(refreshToken)}  ` +
          `success=${successes.length}/${N}`,
      );

      expect(successes).toHaveLength(N);
      expect(upstreamCallsFor(refreshToken)).toBe(1);
    }, 30_000);

    it('latency distribution under contention: p99 < 1s over an uncontended refresh for waiters', async () => {
      const solo = uniqueToken('rt-solo');
      const refreshToken = uniqueToken('rt-shared');
      await Promise.all([seedToken(solo), seedToken(refreshToken)]);
      upstream.latencyMs = 200;

      // What one refresh costs against this database with no contention.
      const soloStart = Date.now();
      const soloResponse = await refresh(solo);
      const uncontendedMs = Date.now() - soloStart;

      expect(soloResponse.status).toBe(200);

      const N = 25;
      const latencies: number[] = [];

      const responses = await Promise.all(
        Array.from({ length: N }, async () => {
          const t0 = Date.now();
          const response = await refresh(refreshToken);
          latencies.push(Date.now() - t0);

          return response;
        }),
      );

      const successes = responses.filter(({ status }) => status === 200);
      const p50 = pct(latencies, 0.5);
      const p95 = pct(latencies, 0.95);
      const p99 = pct(latencies, 0.99);

      console.log(
        `[bench] latency under contention  N=${N}  upstream=${upstreamCallsFor(refreshToken)}  ` +
          `uncontended=${uncontendedMs}ms p50=${p50}ms p95=${p95}ms p99=${p99}ms`,
      );

      expect(successes).toHaveLength(N);
      expect(upstreamCallsFor(refreshToken)).toBe(1);
      // Waiters poll every 100ms, so a waiter finishes within one poll
      // interval plus slack of the holder, far under the 8s waiter budget.
      expect(p99 - uncontendedMs).toBeLessThan(1000);
    }, 30_000);

    it('holder bails pre-upstream → waiters get 400 invalid_grant, not 503', async () => {
      // The RT is never stored: the first arrival becomes the holder, finds
      // it missing, caches the failure, and bails before upstream. Waiters see
      // the cached failure on their next poll and answer 400 instead of timing
      // out with 503.
      const refreshToken = uniqueToken('rt-never-stored');
      const N = 30;

      const responses = await Promise.all(
        Array.from({ length: N }, async () => refresh(refreshToken)),
      );

      const statuses = responses.map(({ status }) => status);

      console.log(
        `[bench] pre-upstream bail  N=${N}  upstream=${upstreamCallsFor(refreshToken)}  ` +
          `statuses=${JSON.stringify(statuses)}`,
      );

      expect(upstreamCallsFor(refreshToken)).toBe(0);
      expect(statuses).toStrictEqual(statuses.map(() => 400));

      const bodies = await Promise.all(
        responses.map(async (response) =>
          OAuthErrorBody.parse(await response.json()),
        ),
      );

      expect(new Set(bodies.map(({ error }) => error))).toStrictEqual(
        new Set(['invalid_grant']),
      );
    }, 30_000);
  });

  describe('Distributed lock across real HTTP listeners', () => {
    it('5 listeners on distinct ports → 1 upstream call from 50 round-robin requests', async () => {
      const refreshToken = uniqueToken('rt-shared');
      await seedToken(refreshToken);
      upstream.latencyMs = 100;

      const listeners = await spawnListeners(5);

      try {
        const N = 50;
        const start = Date.now();

        const results = await Promise.all(
          Array.from({ length: N }, async (_, i) => {
            const listenerIdx = i % listeners.length;

            const result = await refreshVia(
              listenerAt(listeners, listenerIdx),
              refreshToken,
            );

            return { ...result, listenerIdx };
          }),
        );

        const elapsed = Date.now() - start;
        const successes = results.filter(({ status }) => status === 200);

        const distinctListenersHit = new Set(
          successes.map(({ listenerIdx }) => listenerIdx),
        ).size;

        const distinctRTs = new Set(
          successes.map(
            ({ body }) => RotatedPair.parse(JSON.parse(body)).refresh_token,
          ),
        );

        console.log(
          `[bench] multi-listener  listeners=${listeners.length}  N=${N}  ` +
            `upstream=${upstreamCallsFor(refreshToken)}  success=${successes.length}/${N}  ` +
            `distinctListenersHit=${distinctListenersHit}  distinctNewRTs=${distinctRTs.size}  ` +
            `elapsed=${elapsed}ms`,
        );

        // Every listener's requests succeeded, and only one of them called
        // upstream: the lock serialised the instances through the database.
        expect(successes).toHaveLength(N);
        expect(upstreamCallsFor(refreshToken)).toBe(1);
        expect(distinctListenersHit).toBe(listeners.length);
        expect(distinctRTs.size).toBe(1);
      } finally {
        await Promise.all(listeners.map(async (listener) => listener.close()));
      }
    }, 30_000);

    it('10 listeners with distinct refresh_tokens → 1 upstream call per RT, no cross-token contention', async () => {
      const numTokens = 10;
      const reqsPerToken = 5;

      const tokens = Array.from({ length: numTokens }, (_, i) =>
        uniqueToken(`rt-multi-${i}`),
      );

      await Promise.all(
        tokens.map(async (refreshToken) => seedToken(refreshToken)),
      );
      upstream.latencyMs = 50;

      const listeners = await spawnListeners(10);

      try {
        // Every (token, repetition) pair fires at a randomly chosen listener.
        const requests = tokens.flatMap((refreshToken) =>
          Array.from({ length: reqsPerToken }, () => ({
            refreshToken,
            listener: listenerAt(
              listeners,
              Math.floor(Math.random() * listeners.length),
            ),
          })),
        );

        const start = Date.now();

        const results = await Promise.all(
          requests.map(async ({ refreshToken, listener }) =>
            refreshVia(listener, refreshToken),
          ),
        );

        const elapsed = Date.now() - start;
        const successes = results.filter(({ status }) => status === 200);

        console.log(
          `[bench] multi-listener+multi-RT  listeners=${listeners.length}  ` +
            `tokens=${numTokens} reqs/token=${reqsPerToken} total=${requests.length}  ` +
            `success=${successes.length}/${requests.length}  elapsed=${elapsed}ms`,
        );

        expect(successes).toHaveLength(requests.length);
        expect(
          tokens.map((refreshToken) => upstreamCallsFor(refreshToken)),
        ).toStrictEqual(tokens.map(() => 1));
      } finally {
        await Promise.all(listeners.map(async (listener) => listener.close()));
      }
    }, 30_000);
  });
});
