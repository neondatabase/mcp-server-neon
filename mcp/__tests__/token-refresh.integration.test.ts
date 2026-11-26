/**
 * The refresh_token grant of POST /api/token on the real OAuth Postgres
 * store, refresh caches, and Postgres refresh lock, with real openid-client
 * exchanges against a local HTTPS stand-in for Hydra. A test that needs one
 * store operation to fail replaces that operation alone.
 */
import { init } from '@sentry/node';
import { Effect, Layer, Option } from 'effect';
import { HttpRouter } from 'effect/http';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { startHydraStandIn } from './helpers/hydra-stand-in';
import type { HydraAnswer } from './helpers/hydra-stand-in';

// The stand-in serves a throwaway self-signed certificate.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

process.env.CLIENT_ID = 'token-refresh-upstream-client';

process.env.CLIENT_SECRET = 'token-refresh-upstream-secret';

delete process.env.KV_URL;

delete process.env.REDIS_URL;

type Answer = (attempt: number) => Promise<HydraAnswer>;

const issued = () => ({
  access_token: `at-${crypto.randomUUID()}`,
  refresh_token: `rt-${crypto.randomUUID()}`,
});

const rotated = (pair = issued()): HydraAnswer => ({
  kind: 'json',
  status: 200,
  body: { ...pair, token_type: 'bearer', expires_in: 3600 },
});

type OAuthError = {
  readonly error: string;
  readonly error_description?: string;
};

const rejection = (status: number, body: OAuthError): HydraAnswer => ({
  kind: 'json',
  status,
  body,
});

const reset: HydraAnswer = { kind: 'reset' };

const resetThenRotate: Answer = async (attempt) =>
  attempt === 1 ? reset : rotated();

const hang: HydraAnswer = { kind: 'hang' };

/** How the stand-in answers each refresh token; unlisted ones rotate. */
const answers = new Map<string, Answer>();

const attempts = new Map<string, number>();

const hydra = await startHydraStandIn(async ({ refreshToken }) => {
  const attempt = (attempts.get(refreshToken) ?? 0) + 1;
  attempts.set(refreshToken, attempt);

  const answer = answers.get(refreshToken);

  return answer === undefined ? rotated() : answer(attempt);
});

process.env.UPSTREAM_OAUTH_HOST = hydra.issuer;

// Imported once the environment above is set: lib/config reads it on load.
const { OAuthTestApp } = await import('./helpers/oauth-app');
const { OAuthStore } = await import('../oauth/oauth-store');

const { OAuthStoreUnavailable } =
  await import('../oauth/oauth-store-unavailable');

const { RefreshLock } = await import('../oauth/refresh-lock-service');
const { RefreshRotations } = await import('../oauth/refresh-rotations');
const { logStoreFallback } = await import('../oauth/store-fallback');
const { logger } = await import('../utils/logger');

// Server failures the route answers still reach Sentry; these record which.
const reported: string[] = [];

init({
  dsn: 'http://public@127.0.0.1:1/1',
  beforeSend: (event) => {
    reported.push(event.exception?.values?.at(-1)?.type ?? 'unknown');

    return null;
  },
});

// The fields the tests read from each logged line; the rest are dropped.
const LoggedLine = z.object({
  level: z.string(),
  message: z.string(),
  clientId: z.string().optional(),
  store: z.string().optional(),
  operation: z.string().optional(),
  errorName: z.string().optional(),
  errorCode: z.string().optional(),
  upstreamRequest: z.unknown().optional(),
});

const logged: z.infer<typeof LoggedLine>[] = [];

logger.on('data', (info) => {
  logged.push(LoggedLine.parse(info));
});

type StoreOperations = typeof OAuthStore.Service;

type RotationOperations = typeof RefreshRotations.Service;

type Client = {
  readonly id: string;
  readonly secret: string;
  readonly grants: string[];
  readonly redirect_uris: string[];
  readonly client_name: string;
  readonly tokenEndpointAuthMethod: string;
};

const handlers: { readonly dispose: () => Promise<void> }[] = [];

/** The OAuth app with `overrides` merged over its real services. */
const appWith = <ROut>(overrides: Layer.Layer<ROut>) => {
  const handler = HttpRouter.toWebHandler(
    Layer.mergeAll(OAuthTestApp, overrides),
    { disableLogger: true },
  );

  handlers.push(handler);

  return handler;
};

const app = appWith(Layer.empty);

/** The real OAuth store with the operations `overrides` returns replaced. */
const storeWith = (
  overrides: (real: StoreOperations) => Partial<StoreOperations>,
) =>
  Layer.effect(
    OAuthStore,
    OAuthStore.make.pipe(
      Effect.map((real) => OAuthStore.of({ ...real, ...overrides(real) })),
    ),
  );

/** The real store, whose first attempt to persist a token pair fails. */
const failingFirstPersist = (persists: { attempts: number }) =>
  storeWith((real) => ({
    saveTokenPair: (input) =>
      Effect.suspend(() => {
        persists.attempts += 1;

        return persists.attempts === 1
          ? Effect.fail(
              OAuthStoreUnavailable.make({
                operation: 'saveToken',
                cause: new Error('transient blip'),
              }),
            )
          : real.saveTokenPair(input);
      }),
  }));

/** The real refresh caches with the operations `overrides` returns replaced. */
const rotationsWith = (
  overrides: (real: RotationOperations) => Partial<RotationOperations>,
) =>
  Layer.effect(
    RefreshRotations,
    RefreshRotations.make.pipe(
      Effect.map((real) =>
        RefreshRotations.of({ ...real, ...overrides(real) }),
      ),
    ),
  );

const services = Layer.mergeAll(
  OAuthStore.layer,
  RefreshRotations.layer,
  RefreshLock.layer,
);

const onServices = async <A, E>(
  effect: Effect.Effect<A, E, Layer.Success<typeof services>>,
) => Effect.runPromise(effect.pipe(Effect.provide(services)));

const onStore = async <A, E>(
  run: (store: StoreOperations) => Effect.Effect<A, E>,
) => onServices(OAuthStore.pipe(Effect.flatMap(run)));

const onRotations = async <A, E>(
  run: (rotations: RotationOperations) => Effect.Effect<A, E>,
) => onServices(RefreshRotations.pipe(Effect.flatMap(run)));

const markedTransient = async (refreshToken: string) =>
  onServices(
    RefreshLock.pipe(
      Effect.flatMap((lock) => lock.hasTransientFailure({ refreshToken })),
    ),
  );

const registeredClient = async (): Promise<Client> => {
  const client = {
    id: `token-refresh-${crypto.randomUUID()}`,
    secret: 'secret-1',
    grants: ['refresh_token'],
    redirect_uris: ['http://localhost/callback'],
    client_name: 'Test Client',
    tokenEndpointAuthMethod: 'client_secret_post',
  };

  await onStore((store) => store.saveClient({ client, registerHeaders: {} }));

  return client;
};

/** A stored access token and the refresh token that renews it. */
const seededPair = async (input: {
  readonly client: Client;
  readonly grant?: unknown;
}) => {
  const refreshToken = `rt-${crypto.randomUUID()}`;
  const accessToken = `at-${crypto.randomUUID()}`;

  await onStore((store) =>
    store.saveTokenPair({
      token: {
        accessToken,
        refreshToken,
        expires_at: Date.now() + 3_600_000,
        client: input.client,
        user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
        scope: 'read write',
        grant: input.grant,
      },
      refreshToken,
    }),
  );

  return { refreshToken, accessToken };
};

const tokenRequest = (fields: Record<string, string>) =>
  new Request('http://localhost/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });

const refreshRequest = (client: Client, refreshToken: string) =>
  tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: client.id,
    client_secret: client.secret,
  });

const TokenPair = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  token_type: z.literal('bearer'),
  expires_in: z.number(),
});

const OAuthErrorBody = z.object({ error: z.string() });

const requestsFor = (refreshToken: string) =>
  hydra.requests.filter((request) => request.refreshToken === refreshToken);

/** The last SLO line logged for `client`. */
const sloLine = (client: Client) =>
  logged
    .map(({ message }) => message)
    .findLast(
      (message) =>
        message.startsWith('[SLO] refresh ') &&
        message.split(' ').includes(`clientId=${client.id}`),
    );

const accessTokenOf = async (accessToken: string) =>
  onStore((store) => store.findAccessToken({ accessToken }));

const refreshTokenOf = async (refreshToken: string) =>
  onStore((store) => store.findRefreshToken({ refreshToken }));

const cachedFailureOf = async (client: Client, refreshToken: string) =>
  onRotations((rotations) => rotations.cachedFailure({ refreshToken, client }));

/** Whether a cached failure carries a time it failed at, not in the future. */
const failedInThePast = (
  failure: Option.Option<{ readonly failedAt: number }>,
) => failure.pipe(Option.map(({ failedAt }) => failedAt <= Date.now()));

/** The request summary on the upstream-failure log line for `client`. */
const upstreamRequestLogged = (client: Client) =>
  logged.find(
    ({ message, clientId }) =>
      // Winston appends the logged error's own `message` field to the line.
      message.startsWith('Upstream refresh token exchange failed') &&
      clientId === client.id,
  )?.upstreamRequest;

const sentBytes = (refreshToken: string) =>
  requestsFor(refreshToken).reduce(
    (total, { body }) => total + Buffer.byteLength(body),
    0,
  );

const refused = () =>
  Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
    code: 'ECONNREFUSED',
  });

/** What a refresh-cache lookup answers when its read fails. */
const unreadable = (
  store: 'refresh_results' | 'refresh_failures',
  operation: string,
) =>
  logStoreFallback('Refresh cache read failed, continuing without it', {
    store,
    operation,
    cause: refused(),
  }).pipe(Effect.as(Option.none()));

/** An app whose failure-cache reads are counted, and fail when `failing`. */
const failureCacheReads = (failing: boolean) => {
  const reads = { count: 0 };

  const handler = appWith(
    rotationsWith((real) => ({
      cachedFailure: (input) =>
        Effect.suspend(() => {
          reads.count += 1;

          return failing
            ? unreadable('refresh_failures', 'getRefreshFailure')
            : real.cachedFailure(input);
        }),
    })),
  );

  return { handler, reads };
};

/** The answer to a refresh, with the SLO line's elapsed time masked. */
const answered = async (
  handler: ReturnType<typeof appWith>,
  client: Client,
  refreshToken: string,
) => {
  const response = await handler.handler(refreshRequest(client, refreshToken));
  const body: unknown = await response.json();
  const slo = sloLine(client) ?? '';

  return {
    status: response.status,
    body,
    slo: slo.replace(/elapsedMs=\d+/u, 'elapsedMs=*'),
  };
};

const FALLBACK_MESSAGES = new Set([
  'Refresh cache read failed, continuing without it',
  'refresh-lock isHeld failed, still waiting',
  'refresh-lock transient marker read failed, assuming none',
]);

const fallbackWarnings = () =>
  logged.filter(
    ({ level, message }) => level === 'warn' && FALLBACK_MESSAGES.has(message),
  );

const cacheWarning = (store: string, operation: string) => ({
  level: 'warn',
  message: 'Refresh cache read failed, continuing without it',
  store,
  operation,
  errorName: 'Error',
  errorCode: 'ECONNREFUSED',
});

// Each test registers its own client and refresh tokens, and reads back only
// the logs and upstream requests that carry them.
describe.concurrent('Token refresh flow', () => {
  afterAll(async () => {
    await Promise.all(handlers.map(async (handler) => handler.dispose()));
    await hydra.close();
  });

  it('happy path: refreshes token and returns new tokens', async () => {
    const client = await registeredClient();
    const old = await seededPair({ client });

    const response = await app.handler(
      refreshRequest(client, old.refreshToken),
    );

    expect(response.status).toBe(200);

    const pair = TokenPair.parse(await response.json());

    expect(pair.expires_in).toBeGreaterThan(0);
    expect(requestsFor(old.refreshToken)).toHaveLength(1);
    await expect(accessTokenOf(pair.access_token)).resolves.toMatchObject(
      Option.some({
        accessToken: pair.access_token,
        refreshToken: pair.refresh_token,
      }),
    );
    await expect(refreshTokenOf(pair.refresh_token)).resolves.toStrictEqual(
      Option.some({
        refreshToken: pair.refresh_token,
        accessToken: pair.access_token,
      }),
    );
    await expect(accessTokenOf(old.accessToken)).resolves.toStrictEqual(
      Option.none(),
    );
    await expect(refreshTokenOf(old.refreshToken)).resolves.toStrictEqual(
      Option.none(),
    );
    await expect(
      onRotations((rotations) =>
        rotations.ownedResult({ refreshToken: old.refreshToken, client }),
      ),
    ).resolves.toMatchObject(
      Option.some({
        clientId: client.id,
        accessToken: pair.access_token,
        refreshToken: pair.refresh_token,
      }),
    );
  });

  it('carries a pinned roleName and secrets grant onto the refreshed token', async () => {
    const client = await registeredClient();

    const grant = {
      projectId: 'example-project-123',
      scopes: null,
      roleName: 'mcp_pinned_reader',
      secrets: 'none',
    };

    const old = await seededPair({ client, grant });

    const response = await app.handler(
      refreshRequest(client, old.refreshToken),
    );

    expect(response.status).toBe(200);

    const pair = TokenPair.parse(await response.json());

    await expect(accessTokenOf(pair.access_token)).resolves.toMatchObject(
      Option.some({ grant }),
    );
  });

  it('keeps a legacy token without a grant unpinned on refresh', async () => {
    const client = await registeredClient();
    const old = await seededPair({ client });

    const response = await app.handler(
      refreshRequest(client, old.refreshToken),
    );

    expect(response.status).toBe(200);

    const pair = TokenPair.parse(await response.json());
    const saved = await accessTokenOf(pair.access_token);

    expect(saved.pipe(Option.map((token) => 'grant' in token))).toStrictEqual(
      Option.some(false),
    );
  });

  it('does not delete refresh token when upstream reuses the same token string', async () => {
    const client = await registeredClient();
    const old = await seededPair({ client });
    const accessToken = `at-${crypto.randomUUID()}`;

    answers.set(old.refreshToken, async () => ({
      kind: 'json',
      status: 200,
      body: {
        access_token: accessToken,
        token_type: 'bearer',
        expires_in: 3600,
      },
    }));

    const response = await app.handler(
      refreshRequest(client, old.refreshToken),
    );

    expect(response.status).toBe(200);
    await expect(refreshTokenOf(old.refreshToken)).resolves.toStrictEqual(
      Option.some({ refreshToken: old.refreshToken, accessToken }),
    );
  });

  describe('singleflight coalescing (same-instance)', () => {
    it('concurrent requests with same refresh token share one upstream call', async () => {
      const client = await registeredClient();
      const old = await seededPair({ client });
      const second = Promise.withResolvers<undefined>();

      // Upstream answers once both requests are in flight.
      answers.set(old.refreshToken, async () => {
        await second.promise;

        return rotated();
      });

      const first = app.handler(refreshRequest(client, old.refreshToken));
      const next = app.handler(refreshRequest(client, old.refreshToken));

      second.resolve(undefined);

      const responses = await Promise.all([first, next]);

      const bodies = await Promise.all(
        responses.map(async (response) =>
          TokenPair.parse(await response.json()),
        ),
      );

      expect(responses.map(({ status }) => status)).toStrictEqual([200, 200]);
      expect(bodies[1]?.access_token).toBe(bodies[0]?.access_token);
      expect(requestsFor(old.refreshToken)).toHaveLength(1);
    });
  });

  describe('distributed cache fallback (cross-instance)', () => {
    it('returns cached result when refresh token is already consumed', async () => {
      const client = await registeredClient();
      const refreshToken = `rt-consumed-${crypto.randomUUID()}`;

      await onRotations((rotations) =>
        rotations.recordResult({
          refreshToken,
          result: {
            clientId: client.id,
            accessToken: 'cached-access-token',
            refreshToken: 'cached-refresh-token',
            expiresAt: Date.now() + 3_600_000,
            scope: 'read write',
          },
        }),
      );

      const response = await app.handler(refreshRequest(client, refreshToken));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        access_token: 'cached-access-token',
        refresh_token: 'cached-refresh-token',
      });
      expect(requestsFor(refreshToken)).toStrictEqual([]);
    });

    it('returns cached result when upstream rejects with 4xx (token rotation)', async () => {
      const client = await registeredClient();
      const old = await seededPair({ client });

      // A peer's rotation of the same token lands while this one is upstream.
      answers.set(old.refreshToken, async () => {
        await onRotations((rotations) =>
          rotations.recordResult({
            refreshToken: old.refreshToken,
            result: {
              clientId: client.id,
              accessToken: 'cached-access-token',
              refreshToken: 'cached-refresh-token',
              expiresAt: Date.now() + 3_600_000,
              scope: 'read write',
            },
          }),
        );

        return rejection(400, { error: 'invalid_grant' });
      });

      const response = await app.handler(
        refreshRequest(client, old.refreshToken),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        access_token: 'cached-access-token',
        refresh_token: 'cached-refresh-token',
      });
    });

    it('returns error when no cache hit and token is gone', async () => {
      const client = await registeredClient();

      const response = await app.handler(
        refreshRequest(client, `rt-gone-${crypto.randomUUID()}`),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: 'invalid_grant',
      });
    });

    it('returns error when upstream rejects and no cache hit', async () => {
      const client = await registeredClient();
      const old = await seededPair({ client });

      answers.set(old.refreshToken, async () =>
        rejection(400, { error: 'invalid_grant' }),
      );

      const response = await app.handler(
        refreshRequest(client, old.refreshToken),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: 'invalid_grant',
      });
    });

    it('logs a sanitized upstream-request fingerprint on cliff_upstream', async () => {
      // ai-notes/cliff-upstream-investigation.md: when Hydra answers
      // invalid_request, the error log carries a summary of the request that
      // was sent, so dashboards can split the bucket by request shape.
      const client = await registeredClient();
      const old = await seededPair({ client });

      answers.set(old.refreshToken, async () =>
        rejection(400, { error: 'invalid_request' }),
      );

      await app.handler(refreshRequest(client, old.refreshToken));

      expect(requestsFor(old.refreshToken)).toHaveLength(1);
      expect(upstreamRequestLogged(client)).toStrictEqual({
        paramNames: [
          'client_id',
          'client_secret',
          'grant_type',
          'refresh_token',
        ],
        bodyByteLength: sentBytes(old.refreshToken),
        refreshTokenFingerprint: `len=${old.refreshToken.length},prefix=${old.refreshToken.slice(0, 6)}`,
        hasClientSecret: true,
        hasDuplicateParams: false,
      });
    });
  });

  describe('transient errors', () => {
    it('returns 503 on upstream 5xx without deleting tokens', async () => {
      const client = await registeredClient();
      const old = await seededPair({ client });

      answers.set(old.refreshToken, async () =>
        rejection(500, { error: 'server_error' }),
      );

      const response = await app.handler(
        refreshRequest(client, old.refreshToken),
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        error: 'server_error',
      });
      await expect(accessTokenOf(old.accessToken)).resolves.toMatchObject(
        Option.some({ accessToken: old.accessToken }),
      );
      await expect(refreshTokenOf(old.refreshToken)).resolves.toStrictEqual(
        Option.some(old),
      );
    });

    it('marks the token transient on upstream 5xx, so waiters stop waiting', async () => {
      // The lock release writes the transient marker in the same statement
      // (refresh-lock-store.ts), so waiters bail fast as
      // transient_upstream_5xx instead of timing out.
      const client = await registeredClient();
      const old = await seededPair({ client });

      answers.set(old.refreshToken, async () =>
        rejection(500, { error: 'server_error' }),
      );

      await app.handler(refreshRequest(client, old.refreshToken));

      await expect(markedTransient(old.refreshToken)).resolves.toBe(true);
    });

    it('does not mark the token transient on upstream 4xx (it is a hard cliff, not transient)', async () => {
      const client = await registeredClient();
      const old = await seededPair({ client });

      answers.set(old.refreshToken, async () =>
        rejection(401, { error: 'token_inactive' }),
      );

      await app.handler(refreshRequest(client, old.refreshToken));

      await expect(markedTransient(old.refreshToken)).resolves.toBe(false);
    });

    describe('upstream call timeout (slow Hydra cap)', () => {
      // Hydra holds connections open during 5xx bursts (bimodal: <200ms or
      // 4-37s). Capping the upstream call at 4.5s forces the slow mode into
      // the 5xx path before waiters exhaust their lock-poll budget: the lock
      // release writes the transient marker and waiters bail fast as
      // transient_upstream_5xx (excluded from SLO) instead of cascading into
      // transient_lock_timeout (counts BAD).
      const timedOut = async () => {
        const client = await registeredClient();
        const old = await seededPair({ client });

        answers.set(old.refreshToken, async () => hang);

        const response = await app.handler(
          refreshRequest(client, old.refreshToken),
        );

        return { client, old, response };
      };

      it('exchange that exceeds 4.5s is cancelled and surfaces as transient_upstream_5xx', async () => {
        const { client, old, response } = await timedOut();

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toMatchObject({
          error: 'server_error',
        });
        await expect(markedTransient(old.refreshToken)).resolves.toBe(true);
        expect(sloLine(client)).toMatch(/outcome=transient_upstream_5xx\b/u);
      }, 15_000);

      it('upstream timeout is NOT retried (server-side outcome unknown)', async () => {
        const { old } = await timedOut();

        // An unanswered call may have rotated the token at Hydra; a retry
        // could present a rotated token and cliff the chain.
        expect(requestsFor(old.refreshToken)).toHaveLength(1);
      }, 15_000);

      it('upstream timeout does NOT delete tokens (different from 4xx)', async () => {
        const { client, old } = await timedOut();

        // Client retries keep working once upstream recovers.
        await expect(accessTokenOf(old.accessToken)).resolves.toMatchObject(
          Option.some({ accessToken: old.accessToken }),
        );
        await expect(refreshTokenOf(old.refreshToken)).resolves.toStrictEqual(
          Option.some(old),
        );
        await expect(
          cachedFailureOf(client, old.refreshToken),
        ).resolves.toStrictEqual(Option.none());
      }, 15_000);

      it('exchange that completes inside the 4.5s budget is unaffected', async () => {
        const client = await registeredClient();
        const old = await seededPair({ client });

        const response = await app.handler(
          refreshRequest(client, old.refreshToken),
        );

        expect(response.status).toBe(200);
        expect(sloLine(client)).toMatch(/outcome=success\b/u);
      });

      it('aborts the in-flight upstream request on timeout (cancels the socket)', async () => {
        const { old } = await timedOut();

        await vi.waitFor(() => {
          expect(hydra.closedUnanswered).toContain(old.refreshToken);
        });
      }, 15_000);
    });
  });

  describe('failure cache (retry storm absorption)', () => {
    it('writes failure cache when upstream rejects with 4xx', async () => {
      const client = await registeredClient();
      const old = await seededPair({ client });

      answers.set(old.refreshToken, async () =>
        rejection(400, {
          error: 'invalid_grant',
          error_description: 'token expired',
        }),
      );

      const response = await app.handler(
        refreshRequest(client, old.refreshToken),
      );

      expect(response.status).toBe(400);

      const failure = await cachedFailureOf(client, old.refreshToken);

      expect(failure).toMatchObject(
        Option.some({
          oauthError: 'invalid_grant',
          oauthErrorDescription: 'token expired',
        }),
      );
      expect(failedInThePast(failure)).toStrictEqual(Option.some(true));
    });

    it('rejects fast without calling upstream when failure is cached', async () => {
      const client = await registeredClient();
      const old = await seededPair({ client });
      const lookups = { refreshTokens: 0 };

      await onRotations((rotations) =>
        rotations.recordFailure({
          refreshToken: old.refreshToken,
          failure: { failedAt: Date.now() - 5000, oauthError: 'invalid_grant' },
        }),
      );

      const response = await appWith(
        storeWith((real) => ({
          findRefreshToken: (input) =>
            Effect.suspend(() => {
              lookups.refreshTokens += 1;

              return real.findRefreshToken(input);
            }),
        })),
      ).handler(refreshRequest(client, old.refreshToken));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: 'invalid_grant',
      });
      // Upstream and the refresh-token store are not touched.
      expect(requestsFor(old.refreshToken)).toStrictEqual([]);
      expect(lookups.refreshTokens).toBe(0);
      await expect(refreshTokenOf(old.refreshToken)).resolves.toStrictEqual(
        Option.some(old),
      );
    });

    it("serves the client's own cached rotation over a cached failure", async () => {
      const client = await registeredClient();
      const refreshToken = `rt-${crypto.randomUUID()}`;

      await onRotations((rotations) =>
        rotations
          .recordFailure({
            refreshToken,
            failure: {
              failedAt: Date.now() - 5000,
              oauthError: 'invalid_grant',
            },
          })
          .pipe(
            Effect.andThen(
              rotations.recordResult({
                refreshToken,
                result: {
                  clientId: client.id,
                  accessToken: 'cached-access-token',
                  refreshToken: 'cached-refresh-token',
                  expiresAt: Date.now() + 3_600_000,
                },
              }),
            ),
          ),
      );

      const response = await app.handler(refreshRequest(client, refreshToken));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        refresh_token: 'cached-refresh-token',
      });
      expect(sloLine(client)).toMatch(
        /outcome=success .*reason=cache_replay_over_failure/u,
      );
      expect(requestsFor(refreshToken)).toStrictEqual([]);
    });

    it('does not cache failure on transient 5xx', async () => {
      const client = await registeredClient();
      const old = await seededPair({ client });

      answers.set(old.refreshToken, async () =>
        rejection(503, { error: 'server_error' }),
      );

      await app.handler(refreshRequest(client, old.refreshToken));

      await expect(
        cachedFailureOf(client, old.refreshToken),
      ).resolves.toStrictEqual(Option.none());
    });
  });

  describe('pre-upstream failure cache (waiter 503 → 400 fix)', () => {
    it('caches failure when refresh_token is not in storage', async () => {
      const client = await registeredClient();
      const refreshToken = `stale-rt-${crypto.randomUUID()}`;

      const response = await app.handler(refreshRequest(client, refreshToken));

      expect(response.status).toBe(400);

      const failure = await cachedFailureOf(client, refreshToken);

      expect(failure).toMatchObject(
        Option.some({
          oauthError: 'invalid_grant',
          oauthErrorDescription: 'rt_not_found_in_storage',
        }),
      );
      expect(failedInThePast(failure)).toStrictEqual(Option.some(true));
      expect(requestsFor(refreshToken)).toStrictEqual([]);
    });

    it('caches failure when access_token for the refresh_token is missing', async () => {
      const client = await registeredClient();
      const old = await seededPair({ client });

      await onStore((store) =>
        store.findAccessToken({ accessToken: old.accessToken }).pipe(
          Effect.flatMap(Effect.fromOption),
          Effect.flatMap((token) => store.deleteAccessToken({ token })),
        ),
      );

      const response = await app.handler(
        refreshRequest(client, old.refreshToken),
      );

      expect(response.status).toBe(400);
      await expect(
        cachedFailureOf(client, old.refreshToken),
      ).resolves.toMatchObject(
        Option.some({ oauthErrorDescription: 'access_token_not_found' }),
      );
      // The orphaned refresh token is cleaned up.
      await expect(refreshTokenOf(old.refreshToken)).resolves.toStrictEqual(
        Option.none(),
      );
      expect(requestsFor(old.refreshToken)).toStrictEqual([]);
    });

    it('caches a client mismatch for the requesting client only', async () => {
      const client = await registeredClient();
      const owner = await registeredClient();
      const old = await seededPair({ client: owner });

      const response = await app.handler(
        refreshRequest(client, old.refreshToken),
      );

      expect(response.status).toBe(400);
      await expect(
        cachedFailureOf(client, old.refreshToken),
      ).resolves.toMatchObject(
        Option.some({
          clientId: client.id,
          oauthErrorDescription: 'client_mismatch',
        }),
      );
      await expect(
        cachedFailureOf(owner, old.refreshToken),
      ).resolves.toStrictEqual(Option.none());
      expect(requestsFor(old.refreshToken)).toStrictEqual([]);
    });
  });

  describe('SLO instrumentation', () => {
    it('happy path emits outcome=success', async () => {
      const client = await registeredClient();
      const old = await seededPair({ client });

      const response = await app.handler(
        refreshRequest(client, old.refreshToken),
      );

      expect(response.status).toBe(200);

      const line = sloLine(client);

      expect(line).toMatch(/outcome=success\b/u);
      expect(line).toMatch(/elapsedMs=\d+/u);
    });

    it('failure-cache fast-fail emits outcome=correct_invalid_grant', async () => {
      const client = await registeredClient();
      const refreshToken = `rt-${crypto.randomUUID()}`;

      await onRotations((rotations) =>
        rotations.recordFailure({
          refreshToken,
          failure: { failedAt: Date.now() - 5000, oauthError: 'invalid_grant' },
        }),
      );

      const response = await app.handler(refreshRequest(client, refreshToken));

      expect(response.status).toBe(400);
      expect(sloLine(client)).toMatch(/outcome=correct_invalid_grant\b/u);
      expect(sloLine(client)).toMatch(/reason=failure_cache_hit/u);
    });

    it('RT-not-found emits outcome=correct_invalid_grant', async () => {
      const client = await registeredClient();

      const response = await app.handler(
        refreshRequest(client, `stale-rt-${crypto.randomUUID()}`),
      );

      expect(response.status).toBe(400);
      expect(sloLine(client)).toMatch(/outcome=correct_invalid_grant\b/u);
    });

    it('upstream 4xx emits outcome=cliff_upstream with upstreamOauthError plumbed through', async () => {
      const client = await registeredClient();
      const old = await seededPair({ client });

      answers.set(old.refreshToken, async () =>
        rejection(401, { error: 'token_inactive' }),
      );

      const response = await app.handler(
        refreshRequest(client, old.refreshToken),
      );

      expect(response.status).toBe(400);
      expect(sloLine(client)).toMatch(/outcome=cliff_upstream\b/u);
      // Cliff bursts are classified by upstream cause (token_inactive vs
      // invalid_client vs invalid_request) from this field.
      expect(sloLine(client)).toMatch(/upstreamOauthError=token_inactive\b/u);
    });

    it('upstream 5xx emits outcome=transient_upstream_5xx', async () => {
      const client = await registeredClient();
      const old = await seededPair({ client });

      answers.set(old.refreshToken, async () =>
        rejection(502, { error: 'bad_gateway' }),
      );

      const response = await app.handler(
        refreshRequest(client, old.refreshToken),
      );

      expect(response.status).toBe(503);
      expect(sloLine(client)).toMatch(/outcome=transient_upstream_5xx\b/u);
    });

    it('upstream HTTP 5xx is NOT retried (response means Hydra processed it)', async () => {
      const client = await registeredClient();
      const old = await seededPair({ client });

      answers.set(old.refreshToken, async () =>
        rejection(502, { error: 'bad_gateway' }),
      );

      await app.handler(refreshRequest(client, old.refreshToken));

      // Retrying an HTTP response could present an already-rotated RT.
      expect(requestsFor(old.refreshToken)).toHaveLength(1);
    });

    it('upstream connection reset emits outcome=transient_upstream_network', async () => {
      const client = await registeredClient();
      const old = await seededPair({ client });

      answers.set(old.refreshToken, async () => reset);

      const response = await app.handler(
        refreshRequest(client, old.refreshToken),
      );

      expect(response.status).toBe(503);
      expect(sloLine(client)).toMatch(/outcome=transient_upstream_network\b/u);
    });

    it('upstream network error is retried, succeeds on attempt 2', async () => {
      const client = await registeredClient();
      const old = await seededPair({ client });

      answers.set(old.refreshToken, resetThenRotate);

      const response = await app.handler(
        refreshRequest(client, old.refreshToken),
      );

      expect(response.status).toBe(200);
      expect(sloLine(client)).toMatch(/outcome=success\b/u);
      expect(requestsFor(old.refreshToken)).toHaveLength(2);
    });

    it('upstream network error that survives all retries surfaces as transient_upstream_network', async () => {
      const client = await registeredClient();
      const old = await seededPair({ client });

      answers.set(old.refreshToken, async () => reset);

      await app.handler(refreshRequest(client, old.refreshToken));

      // Two attempts (the upstream retry allows one retry), both fail.
      expect(requestsFor(old.refreshToken)).toHaveLength(2);
      expect(sloLine(client)).toMatch(/outcome=transient_upstream_network\b/u);
    });

    it('persist failure after upstream success degrades to 200 via cache + SLO captures persist-failure', async () => {
      const client = await registeredClient();
      const old = await seededPair({ client });
      const pair = issued();

      answers.set(old.refreshToken, async () => rotated(pair));

      // Every persist attempt fails; the success cache was written before.
      const response = await appWith(
        storeWith(() => ({
          saveTokenPair: () =>
            Effect.fail(
              OAuthStoreUnavailable.make({
                operation: 'saveToken',
                cause: new Error('postgres down'),
              }),
            ),
        })),
      ).handler(refreshRequest(client, old.refreshToken));

      // The client gets the rotated pair from the cross-instance cache.
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject(pair);
      await expect(accessTokenOf(pair.access_token)).resolves.toStrictEqual(
        Option.none(),
      );
      // A bad SLO outcome despite the 200, so Postgres degradation shows.
      expect(sloLine(client)).toMatch(/outcome=transient_persist_failure\b/u);
      expect(sloLine(client)).toMatch(/reason=recovered_via_cache/u);
      // The persist failure is the server's, so Sentry gets it once.
      await vi.waitFor(() => {
        expect(reported).toStrictEqual(['RefreshFailed']);
      });
    });

    it('persist retry — succeeds on attempt 2 emits outcome=success', async () => {
      const client = await registeredClient();
      const old = await seededPair({ client });
      const persists = { attempts: 0 };

      const response = await appWith(failingFirstPersist(persists)).handler(
        refreshRequest(client, old.refreshToken),
      );

      expect(response.status).toBe(200);

      const pair = TokenPair.parse(await response.json());

      expect(sloLine(client)).toMatch(/outcome=success\b/u);
      expect(persists.attempts).toBe(2);
      await expect(refreshTokenOf(pair.refresh_token)).resolves.toStrictEqual(
        Option.some({
          refreshToken: pair.refresh_token,
          accessToken: pair.access_token,
        }),
      );
    });

    it('missing refresh_token in body emits outcome=bad_request', async () => {
      const client = await registeredClient();

      const response = await app.handler(
        tokenRequest({
          grant_type: 'refresh_token',
          client_id: client.id,
          client_secret: client.secret,
        }),
      );

      expect(response.status).toBe(400);
      expect(sloLine(client)).toMatch(/outcome=bad_request\b/u);
    });
  });

  // These count every fallback warning and Sentry event, so nothing else runs.
  describe.sequential('store reads that fall back', () => {
    beforeEach(() => {
      logged.length = 0;
      reported.length = 0;
    });

    it('answers as with an empty failure cache when reading it fails, logging it once', async () => {
      const client = await registeredClient();
      const healthyApp = failureCacheReads(false);
      const degradedApp = failureCacheReads(true);

      const healthy = await answered(
        healthyApp.handler,
        client,
        `rt-unknown-${crypto.randomUUID()}`,
      );

      const degraded = await answered(
        degradedApp.handler,
        client,
        `rt-unknown-${crypto.randomUUID()}`,
      );

      expect(healthy.status).toBe(400);
      expect(degraded).toStrictEqual(healthy);
      expect(healthyApp.reads.count).toBe(2);
      expect(degradedApp.reads.count).toBe(2);
      expect(fallbackWarnings()).toStrictEqual([
        cacheWarning('refresh_failures', 'getRefreshFailure'),
      ]);
      expect(reported).toStrictEqual([]);
    });

    it('logs a failed cache read once in each of two concurrent requests', async () => {
      const client = await registeredClient();
      const degradedApp = failureCacheReads(true);

      const responses = await Promise.all([
        degradedApp.handler.handler(
          refreshRequest(client, `concurrent-rt-a-${crypto.randomUUID()}`),
        ),
        degradedApp.handler.handler(
          refreshRequest(client, `concurrent-rt-b-${crypto.randomUUID()}`),
        ),
      ]);

      expect(responses.map(({ status }) => status)).toStrictEqual([400, 400]);
      expect(degradedApp.reads.count).toBe(4);
      expect(fallbackWarnings()).toStrictEqual([
        cacheWarning('refresh_failures', 'getRefreshFailure'),
        cacheWarning('refresh_failures', 'getRefreshFailure'),
      ]);
      expect(reported).toStrictEqual([]);
    });

    it('answers as with no cached rotation when reading it fails', async () => {
      const client = await registeredClient();
      const refreshToken = `rt-${crypto.randomUUID()}`;

      await onRotations((rotations) =>
        rotations.recordFailure({
          refreshToken,
          failure: { failedAt: Date.now() - 5000, oauthError: 'invalid_grant' },
        }),
      );

      const healthy = await answered(app, client, refreshToken);

      const degraded = await answered(
        appWith(
          rotationsWith(() => ({
            attributedOutcome: () =>
              unreadable('refresh_results', 'getRefreshRotation'),
          })),
        ),
        client,
        refreshToken,
      );

      expect(healthy.status).toBe(400);
      expect(OAuthErrorBody.parse(healthy.body).error).toBe('invalid_grant');
      expect(degraded).toStrictEqual(healthy);
      expect(fallbackWarnings()).toStrictEqual([
        cacheWarning('refresh_results', 'getRefreshRotation'),
      ]);
      expect(reported).toStrictEqual([]);
    });
  });
});
