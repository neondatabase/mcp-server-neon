/**
 * The refresh-cache and refresh-lock reads that answer with a fallback when
 * their store fails: against an OAuth Postgres URL that refuses connections
 * and a lock store that throws, each keeps its fallback, logs a warning that
 * names the store and the error, and records it on its span, without a Sentry
 * error event.
 */
import { getClient, init, spanToJSON } from '@sentry/node';
import { Effect, Option } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WinstonLoggerLayer } from '../../lib/effect/logger';
import {
  __resetForTests,
  __setRefreshLockStoresForTests,
} from '../oauth/refresh-lock';
import { RefreshLock } from '../oauth/refresh-lock-service';
import type { RefreshLockStore } from '../oauth/refresh-lock-store';
import { RefreshRotations } from '../oauth/refresh-rotations';
import { SentryLayer } from '../sentry/effect';
import { logger } from '../utils/logger';

process.env.OAUTH_DATABASE_URL = 'postgresql://127.0.0.1:1/oauth';

delete process.env.KV_URL;

delete process.env.REDIS_URL;

const errorEvents: unknown[] = [];

init({
  dsn: 'http://public@127.0.0.1:1/1',
  tracesSampleRate: 1,
  beforeSend: (event) => {
    errorEvents.push(event);

    return null;
  },
});

const endedSpans: {
  readonly description: string | undefined;
  readonly status: string | undefined;
  readonly fallbackStore: unknown;
  readonly fallbackOperation: unknown;
  readonly fallbackError: unknown;
}[] = [];

getClient()?.on('spanEnd', (span) => {
  const { description, status, data } = spanToJSON(span);

  endedSpans.push({
    description,
    status,
    fallbackStore: data['fallback.store'],
    fallbackOperation: data['fallback.operation'],
    fallbackError: data['fallback.error'],
  });
});

const spansNamed = (name: string) =>
  endedSpans.filter(({ description }) => description === name);

const logged: Readonly<Record<string, string>>[] = [];

logger.on('data', (info: { level: string; message: string }) => {
  logged.push(Object.fromEntries(Object.entries(info)));
});

const warnings = () => logged.filter(({ level }) => level === 'warn');

const run = async <A, E>(
  effect: Effect.Effect<A, E, RefreshRotations | RefreshLock>,
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide([
        RefreshRotations.layer,
        RefreshLock.layer,
        SentryLayer,
        WinstonLoggerLayer,
      ]),
    ),
  );

const refreshToken = `rt-fallback-${crypto.randomUUID()}`;

const client = { id: 'fallback-client', grants: ['refresh_token'] };

const refused = () =>
  Object.assign(new Error(`store refused ${refreshToken}`), {
    code: 'ECONNREFUSED',
  });

/** A lock another owner holds, in a store whose reads throw. */
const unreadableLockStore = (calls: { acquire: number }) =>
  ({
    name: 'postgres',
    tryAcquire: async () => {
      calls.acquire += 1;

      return false;
    },
    isHeld: async () => {
      throw refused();
    },
    extend: async () => undefined,
    release: async () => undefined,
    markTransient: async () => undefined,
    hasTransient: async () => {
      throw refused();
    },
  }) satisfies RefreshLockStore;

/**
 * A waiter's peek, which reads the transient marker like the token route's,
 * finding the holder's result on its `round`th call.
 */
const peekResolvingOn = (round: number, peeks: { count: number }) =>
  Effect.gen(function* () {
    const lock = yield* RefreshLock;
    yield* lock.hasTransientFailure({ refreshToken });
    peeks.count += 1;

    return Option.some('peer result').pipe(
      Option.filter(() => peeks.count >= round),
    );
  });

const cacheFallback = (store: string, operation: string) => ({
  level: 'warn',
  message: 'Refresh cache read failed, continuing without it',
  store,
  operation,
  errorName: 'Error',
  errorCode: 'ECONNREFUSED',
});

describe('store reads that fall back', () => {
  beforeEach(() => {
    logged.length = 0;
    endedSpans.length = 0;
    errorEvents.length = 0;
  });

  afterEach(() => {
    __resetForTests();
  });

  describe('refresh-cache reads with the OAuth store down', () => {
    it('answers ownedResult with None and logs the failed read', async () => {
      const result = await run(
        Effect.gen(function* () {
          const rotations = yield* RefreshRotations;

          return yield* rotations.ownedResult({ refreshToken, client });
        }),
      );

      expect(result).toStrictEqual(Option.none());
      expect(warnings()).toStrictEqual([
        cacheFallback('refresh_results', 'getOwnedRefreshResult'),
      ]);
      expect(spansNamed('OAuthModel.getOwnedRefreshResult')).toStrictEqual([
        {
          description: 'OAuthModel.getOwnedRefreshResult',
          status: 'internal_error',
          fallbackStore: undefined,
          fallbackOperation: undefined,
          fallbackError: undefined,
        },
      ]);
      expect(spansNamed('RefreshRotations.ownedResult')).toStrictEqual([
        {
          description: 'RefreshRotations.ownedResult',
          status: 'ok',
          fallbackStore: 'refresh_results',
          fallbackOperation: 'getOwnedRefreshResult',
          fallbackError: 'ECONNREFUSED',
        },
      ]);
      expect(errorEvents).toStrictEqual([]);
    }, 30_000);

    it('answers attributedOutcome with None and logs the failed read', async () => {
      const result = await run(
        Effect.gen(function* () {
          const rotations = yield* RefreshRotations;

          return yield* rotations.attributedOutcome({ refreshToken, client });
        }),
      );

      expect(result).toStrictEqual(Option.none());
      expect(warnings()).toStrictEqual([
        cacheFallback('refresh_results', 'getRefreshRotation'),
      ]);
      expect(spansNamed('RefreshRotations.attributedOutcome')).toStrictEqual([
        {
          description: 'RefreshRotations.attributedOutcome',
          status: 'ok',
          fallbackStore: 'refresh_results',
          fallbackOperation: 'getRefreshRotation',
          fallbackError: 'ECONNREFUSED',
        },
      ]);
      expect(errorEvents).toStrictEqual([]);
    }, 30_000);

    it('answers cachedFailure with None and logs the failed read', async () => {
      const result = await run(
        Effect.gen(function* () {
          const rotations = yield* RefreshRotations;

          return yield* rotations.cachedFailure({ refreshToken, client });
        }),
      );

      expect(result).toStrictEqual(Option.none());
      expect(warnings()).toStrictEqual([
        cacheFallback('refresh_failures', 'getRefreshFailure'),
      ]);
      expect(spansNamed('RefreshRotations.cachedFailure')).toStrictEqual([
        {
          description: 'RefreshRotations.cachedFailure',
          status: 'ok',
          fallbackStore: 'refresh_failures',
          fallbackOperation: 'getRefreshFailure',
          fallbackError: 'ECONNREFUSED',
        },
      ]);
      expect(errorEvents).toStrictEqual([]);
    }, 30_000);
  });

  describe('refresh-lock reads with the lock store failing', () => {
    it('counts a failed transient-marker read as no marker and logs it', async () => {
      __setRefreshLockStoresForTests([unreadableLockStore({ acquire: 0 })]);

      const marked = await run(
        Effect.gen(function* () {
          const lock = yield* RefreshLock;

          return yield* lock.hasTransientFailure({ refreshToken });
        }),
      );

      expect(marked).toBe(false);
      expect(warnings()).toStrictEqual([
        {
          level: 'warn',
          message: 'refresh-lock transient marker read failed, assuming none',
          store: 'postgres',
          operation: 'hasTransient',
          errorName: 'Error',
          errorCode: 'ECONNREFUSED',
        },
      ]);
      expect(spansNamed('RefreshLock.hasTransientFailure')).toStrictEqual([
        {
          description: 'RefreshLock.hasTransientFailure',
          status: 'ok',
          fallbackStore: 'postgres',
          fallbackOperation: 'hasTransient',
          fallbackError: 'ECONNREFUSED',
        },
      ]);
      expect(JSON.stringify(logged)).not.toContain(refreshToken);
      expect(errorEvents).toStrictEqual([]);
    });

    it('keeps waiting on failed reads without taking over, logging each read once', async () => {
      const calls = { acquire: 0 };
      const peeks = { count: 0 };
      __setRefreshLockStoresForTests([unreadableLockStore(calls)]);

      const result = await run(
        Effect.gen(function* () {
          const lock = yield* RefreshLock;

          return yield* lock.withLock({
            refreshToken,
            execute: () => Effect.succeed('executed'),
            peek: peekResolvingOn(10, peeks),
          });
        }),
      );

      expect(result).toBe('peer result');
      expect(calls.acquire).toBe(1);
      expect(peeks.count).toBe(10);
      expect(warnings()).toStrictEqual([
        {
          level: 'warn',
          message: 'refresh-lock transient marker read failed, assuming none',
          store: 'postgres',
          operation: 'hasTransient',
          errorName: 'Error',
          errorCode: 'ECONNREFUSED',
        },
        {
          level: 'warn',
          message: 'refresh-lock isHeld failed, still waiting',
          store: 'postgres',
          operation: 'isHeld',
          errorName: 'Error',
          errorCode: 'ECONNREFUSED',
        },
      ]);
      expect(spansNamed('RefreshLock.wait')).toStrictEqual([
        {
          description: 'RefreshLock.wait',
          status: 'ok',
          fallbackStore: 'postgres',
          fallbackOperation: 'isHeld',
          fallbackError: 'ECONNREFUSED',
        },
      ]);
      expect(spansNamed('RefreshLock.hasTransientFailure')).toHaveLength(10);
      expect(
        spansNamed('RefreshLock.hasTransientFailure').every(
          ({ fallbackOperation }) => fallbackOperation === 'hasTransient',
        ),
      ).toBe(true);
      expect(JSON.stringify(logged)).not.toContain(refreshToken);
      expect(errorEvents).toStrictEqual([]);
    });
  });
});
