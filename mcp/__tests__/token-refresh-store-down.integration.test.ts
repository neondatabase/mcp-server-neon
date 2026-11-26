/**
 * The refresh_token grant of POST /api/token with the OAuth database
 * refusing connections and the refresh lock held by another owner in a store
 * whose reads throw. Only the client lookup is answered, so the request
 * reaches the refresh: a waiter that can read nothing keeps waiting until the
 * lock timeout, logging each failed read once.
 */
import { init } from '@sentry/node';
import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/http';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { RefreshLockStore } from '../oauth/refresh-lock-store';

process.env.OAUTH_DATABASE_URL = 'postgresql://127.0.0.1:1/oauth';

delete process.env.KV_URL;

delete process.env.REDIS_URL;

const { AppLayer } = await import('../../lib/http/app');
const { OAuthRoutes } = await import('../../lib/http/routes/oauth');
const { UpstreamOAuth } = await import('../../lib/oauth/upstream-oauth');

const { UpstreamOAuthFailed } =
  await import('../../lib/oauth/upstream-oauth-failed');

const { OAuthStore } = await import('../oauth/oauth-store');

const { __setRefreshLockStoresForTests } =
  await import('../oauth/refresh-lock');

const { RefreshRotations } = await import('../oauth/refresh-rotations');
const { logger } = await import('../utils/logger');

const reported: string[] = [];

init({
  dsn: 'http://public@127.0.0.1:1/1',
  beforeSend: (event) => {
    reported.push(event.exception?.values?.at(-1)?.type ?? 'unknown');

    return null;
  },
});

// The fields the test reads from each logged line; the rest are dropped.
const LoggedLine = z.object({
  level: z.string(),
  message: z.string(),
  store: z.string().optional(),
  operation: z.string().optional(),
  errorName: z.string().optional(),
  errorCode: z.string().optional(),
});

const logged: z.infer<typeof LoggedLine>[] = [];

logger.on('data', (info) => {
  logged.push(LoggedLine.parse(info));
});

const client = {
  id: `token-refresh-store-down-${crypto.randomUUID()}`,
  secret: 'secret-1',
  grants: ['refresh_token'],
  redirect_uris: ['http://localhost/callback'],
  client_name: 'Test Client',
  tokenEndpointAuthMethod: 'client_secret_post',
};

const refused = () =>
  Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
    code: 'ECONNREFUSED',
  });

/** A lock another owner holds, in a store whose reads throw. */
const unreadableLockStore = {
  name: 'postgres',
  tryAcquire: async () => false,
  isHeld: async () => {
    throw refused();
  },
  extend: async () => undefined,
  release: async () => undefined,
  markTransient: async () => undefined,
  hasTransient: async () => {
    throw refused();
  },
} satisfies RefreshLockStore;

const reads = { failureCache: 0, ownedResult: 0, upstream: 0 };

// The real refresh caches, counting their reads of the unreachable store.
const countedRotations = Layer.effect(
  RefreshRotations,
  RefreshRotations.make.pipe(
    Effect.map((real) =>
      RefreshRotations.of({
        ...real,
        cachedFailure: (input) =>
          Effect.suspend(() => {
            reads.failureCache += 1;

            return real.cachedFailure(input);
          }),
        ownedResult: (input) =>
          Effect.suspend(() => {
            reads.ownedResult += 1;

            return real.ownedResult(input);
          }),
      }),
    ),
  ),
);

const knownClient = Layer.effect(
  OAuthStore,
  OAuthStore.make.pipe(
    Effect.map((real) =>
      OAuthStore.of({ ...real, findClient: () => Effect.succeedSome(client) }),
    ),
  ),
);

// Records any upstream call; this test expects none.
const countedUpstream = Layer.effect(
  UpstreamOAuth,
  UpstreamOAuth.make.pipe(
    Effect.map((real) =>
      UpstreamOAuth.of({
        ...real,
        exchangeRefreshToken: () =>
          Effect.suspend(() => {
            reads.upstream += 1;

            return Effect.fail(
              UpstreamOAuthFailed.make({
                operation: 'exchangeRefreshToken',
                cause: new Error('upstream is not part of this test'),
              }),
            );
          }),
      }),
    ),
  ),
);

const handler = HttpRouter.toWebHandler(
  Layer.mergeAll(
    OAuthRoutes,
    AppLayer,
    knownClient,
    countedRotations,
    countedUpstream,
  ),
  { disableLogger: true },
);

const CACHE_READ_FAILED = 'Refresh cache read failed, continuing without it';
const IS_HELD_FAILED = 'refresh-lock isHeld failed, still waiting';

const MARKER_READ_FAILED =
  'refresh-lock transient marker read failed, assuming none';

const FALLBACK_MESSAGES = new Set([
  CACHE_READ_FAILED,
  IS_HELD_FAILED,
  MARKER_READ_FAILED,
]);

const fallback = (message: string, store: string, operation: string) => ({
  level: 'warn',
  message,
  store,
  operation,
  errorName: 'Error',
  errorCode: 'ECONNREFUSED',
});

const sloLines = () =>
  logged.flatMap(({ message }) =>
    message.startsWith('[SLO] refresh ')
      ? [message.replace(/elapsedMs=\d+/u, 'elapsedMs=*')]
      : [],
  );

const fallbackWarnings = () =>
  logged.filter(
    ({ level, message }) => level === 'warn' && FALLBACK_MESSAGES.has(message),
  );

describe('POST /api/token refresh with every store read failing', () => {
  afterAll(async () => {
    await handler.dispose();
  });

  it('keeps a waiter waiting until the lock timeout when every store read fails, logging each once', async () => {
    __setRefreshLockStoresForTests([unreadableLockStore]);

    const response = await handler.handler(
      new Request('http://localhost/api/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: `rt-${crypto.randomUUID()}`,
          client_id: client.id,
          client_secret: client.secret,
        }).toString(),
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toStrictEqual({
      error: 'temporarily_unavailable',
      error_description:
        'A refresh of this token is in progress; please retry shortly',
    });

    expect(sloLines()).toStrictEqual([
      `[SLO] refresh outcome=transient_lock_timeout elapsedMs=* clientId=${client.id}`,
    ]);
    expect(reads.upstream).toBe(0);
    expect(reads.failureCache).toBeGreaterThanOrEqual(50);
    expect(reads.ownedResult).toBeGreaterThanOrEqual(50);
    expect(fallbackWarnings()).toStrictEqual([
      fallback(CACHE_READ_FAILED, 'refresh_failures', 'getRefreshFailure'),
      fallback(MARKER_READ_FAILED, 'postgres', 'hasTransient'),
      fallback(CACHE_READ_FAILED, 'refresh_results', 'getOwnedRefreshResult'),
      fallback(IS_HELD_FAILED, 'postgres', 'isHeld'),
    ]);
    expect(reported).toStrictEqual([]);
  }, 15_000);
});
