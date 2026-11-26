/**
 * The refresh-token lock algorithm (`RefreshLock`) against the real Postgres
 * lock store. Another instance is played by a second owner taking the same
 * lock through the store directly.
 */
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { neon } from '@neondatabase/serverless';
import { Effect, Exit, Option, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureOauthDatabaseUrl } from '../../e2e/provision-oauth-db';
import {
  __resetForTests,
  __setRefreshLockStoreForTests,
} from '../oauth/refresh-lock';
import { RefreshLock } from '../oauth/refresh-lock-service';
import { RefreshLockTimeout } from '../oauth/refresh-lock-timeout';
import type { ReleaseHint } from '../oauth/refresh-lock-service';
import {
  createPostgresRefreshLockStore,
  ensureRefreshLockSchema,
} from '../oauth/refresh-lock-store';
import type { RefreshLockStore } from '../oauth/refresh-lock-store';

class StepFailed extends Schema.TaggedError<
  StepFailed,
  { readonly brand: unique symbol }
>()('StepFailed', { step: Schema.String }) {}

const databaseUrl = await ensureOauthDatabaseUrl();

/** The test database's connection string, pointed at a port nothing serves. */
const refusingDatabaseUrl = Object.assign(new URL(databaseUrl), {
  host: '127.0.0.1:1',
}).toString();

await ensureRefreshLockSchema(databaseUrl);

const store = createPostgresRefreshLockStore(databaseUrl);

const newToken = () => `rt-lock-${randomUUID()}`;

const lockKey = (refreshToken: string) =>
  createHash('sha256').update(refreshToken).digest('hex');

/** When the live lock on `refreshToken` expires, in epoch milliseconds. */
const lockExpiryMs = async (refreshToken: string) => {
  const sql = neon(databaseUrl);

  const rows = await sql`
    SELECT extract(epoch FROM expires_at) * 1000 AS ms
    FROM mcpauth.refresh_locks
    WHERE key = ${lockKey(refreshToken)} AND expires_at > now()
  `;

  return rows.map((row) => Number(row.ms));
};

const withLock = async <A, E1, E2>(input: {
  readonly refreshToken: string;
  readonly execute: (release: ReleaseHint) => Effect.Effect<A, E1>;
  readonly peek: Effect.Effect<Option.Option<A>, E2>;
}) =>
  Effect.runPromiseExit(
    RefreshLock.pipe(
      Effect.flatMap((lock) => lock.withLock(input)),
      Effect.provide(RefreshLock.layer),
    ),
  );

const hasTransientFailure = async (refreshToken: string) =>
  Effect.runPromise(
    RefreshLock.pipe(
      Effect.flatMap((lock) => lock.hasTransientFailure({ refreshToken })),
      Effect.provide(RefreshLock.layer),
    ),
  );

const failureOf = <A, E>(exit: Exit.Exit<A, E>) =>
  Option.getOrUndefined(Exit.findErrorOption(exit));

/** A peek that counts its calls and finds `answer` from call `from` on. */
const countingPeek = <A>(answer: A, from: number) => {
  const calls = { count: 0 };

  const peek = Effect.sync(() => {
    calls.count += 1;

    return Option.some(answer).pipe(Option.filter(() => calls.count >= from));
  });

  return { calls, peek };
};

const countingExecute = <A>(answer: A) => {
  const calls = { count: 0 };

  const execute = () =>
    Effect.sync(() => {
      calls.count += 1;

      return answer;
    });

  return { calls, execute };
};

/**
 * A peek whose first call lets the peer's lock go, as a holder finishing
 * between the waiter's peek and its lock check would, and whose later calls
 * find the holder's answer.
 */
const peekRacingRelease = (refreshToken: string, peer: string) => {
  const calls = { count: 0 };

  const peek = Effect.promise(async () => {
    calls.count += 1;

    if (calls.count > 1) {
      return Option.some('cached-by-peer');
    }

    await store.release(refreshToken, peer);

    return Option.none<string>();
  });

  return { calls, peek };
};

/** Two waiters' shared view of the answer whoever takes over writes. */
const takeoverAnswer = () => {
  const answer = { value: Option.none<string>(), executions: 0 };

  const execute = () =>
    Effect.sleep('300 millis').pipe(
      Effect.andThen(
        Effect.sync(() => {
          answer.executions += 1;
          answer.value = Option.some('cached-by-new-holder');

          return 'cached-by-new-holder';
        }),
      ),
    );

  return { answer, execute, peek: Effect.sync(() => answer.value) };
};

const neverPeek = Effect.succeedNone;

describe('RefreshLock against the Postgres store', () => {
  afterEach(() => {
    __resetForTests();
  });

  describe('withLock', () => {
    it('runs execute directly when no store is configured', async () => {
      __setRefreshLockStoreForTests(null);
      const { calls: peeks, peek } = countingPeek('cached', 1);
      const { calls: executions, execute } = countingExecute('fresh');

      const exit = await withLock({ refreshToken: newToken(), execute, peek });

      expect(exit).toStrictEqual(Exit.succeed('fresh'));
      expect(executions.count).toBe(1);
      expect(peeks.count).toBe(0);
    });

    it('runs execute directly when the store refuses connections', async () => {
      const refusing = createPostgresRefreshLockStore(refusingDatabaseUrl);
      __setRefreshLockStoreForTests(refusing);
      const { calls: executions, execute } = countingExecute('fresh');

      await expect(
        refusing.tryAcquire(newToken(), 'probe', 6000),
      ).rejects.toThrow('Error connecting to database');

      const exit = await withLock({
        refreshToken: newToken(),
        execute,
        peek: neverPeek,
      });

      expect(exit).toStrictEqual(Exit.succeed('fresh'));
      expect(executions.count).toBe(1);
    });

    it('peeks once after acquiring, then executes and releases the lock', async () => {
      __setRefreshLockStoreForTests(store);
      const refreshToken = newToken();
      const { calls: peeks, peek } = countingPeek('cached', 2);
      const { calls: executions, execute } = countingExecute('fresh');

      const exit = await withLock({ refreshToken, execute, peek });

      expect(exit).toStrictEqual(Exit.succeed('fresh'));
      expect(peeks.count).toBe(1);
      expect(executions.count).toBe(1);
      await expect(store.isHeld(refreshToken)).resolves.toBe(false);
    });

    it('returns what the peek after acquiring finds without executing, and releases', async () => {
      __setRefreshLockStoreForTests(store);
      const refreshToken = newToken();
      const { calls: executions, execute } = countingExecute('fresh');

      const exit = await withLock({
        refreshToken,
        execute,
        peek: Effect.succeedSome('cached'),
      });

      expect(exit).toStrictEqual(Exit.succeed('cached'));
      expect(executions.count).toBe(0);
      await expect(store.isHeld(refreshToken)).resolves.toBe(false);
    });

    it('releases the lock when the peek after acquiring fails', async () => {
      __setRefreshLockStoreForTests(store);
      const refreshToken = newToken();
      const { calls: executions, execute } = countingExecute('fresh');
      const failure = StepFailed.make({ step: 'peek' });

      const exit = await withLock({
        refreshToken,
        execute,
        peek: Effect.fail(failure),
      });

      expect(exit).toStrictEqual(Exit.fail(failure));
      expect(executions.count).toBe(0);
      await expect(store.isHeld(refreshToken)).resolves.toBe(false);
    });

    it('releases the lock when execute fails', async () => {
      __setRefreshLockStoreForTests(store);
      const refreshToken = newToken();
      const failure = StepFailed.make({ step: 'execute' });

      const exit = await withLock({
        refreshToken,
        execute: () => Effect.fail(failure),
        peek: neverPeek,
      });

      expect(exit).toStrictEqual(Exit.fail(failure));
      await expect(store.isHeld(refreshToken)).resolves.toBe(false);
    });

    it('polls the peek while another instance holds the lock', async () => {
      __setRefreshLockStoreForTests(store);
      const refreshToken = newToken();
      await expect(store.tryAcquire(refreshToken, 'peer', 6000)).resolves.toBe(
        true,
      );
      const { calls: peeks, peek } = countingPeek('cached-by-peer', 3);
      const { calls: executions, execute } = countingExecute('fresh');

      const exit = await withLock({ refreshToken, execute, peek });

      expect(exit).toStrictEqual(Exit.succeed('cached-by-peer'));
      expect(peeks.count).toBe(3);
      expect(executions.count).toBe(0);
      await store.release(refreshToken, 'peer');
    });

    it('fails with RefreshLockTimeout when the holder never answers', async () => {
      __setRefreshLockStoreForTests(store);
      const refreshToken = newToken();
      await expect(
        store.tryAcquire(refreshToken, 'peer', 20_000),
      ).resolves.toBe(true);
      const { calls: executions, execute } = countingExecute('fresh');

      const exit = await withLock({ refreshToken, execute, peek: neverPeek });

      expect(failureOf(exit)).toBeInstanceOf(RefreshLockTimeout);
      expect(executions.count).toBe(0);
      await store.release(refreshToken, 'peer');
    }, 20_000);

    it('takes over and executes once the holder vanishes without an answer', async () => {
      __setRefreshLockStoreForTests(store);
      const refreshToken = newToken();
      await expect(store.tryAcquire(refreshToken, 'peer', 500)).resolves.toBe(
        true,
      );
      const { calls: executions, execute } = countingExecute('took-over');
      const started = Date.now();

      const exit = await withLock({ refreshToken, execute, peek: neverPeek });

      expect(exit).toStrictEqual(Exit.succeed('took-over'));
      expect(executions.count).toBe(1);
      expect(Date.now() - started).toBeLessThan(3000);
      await expect(store.isHeld(refreshToken)).resolves.toBe(false);
    });

    it('lets one of two waiters take over a vanished lock; the other reads its answer', async () => {
      __setRefreshLockStoreForTests(store);
      const refreshToken = newToken();
      await expect(store.tryAcquire(refreshToken, 'peer', 500)).resolves.toBe(
        true,
      );
      const { answer, execute, peek } = takeoverAnswer();

      const exits = await Promise.all([
        withLock({ refreshToken, execute, peek }),
        withLock({ refreshToken, execute, peek }),
      ]);

      expect(exits).toStrictEqual([
        Exit.succeed('cached-by-new-holder'),
        Exit.succeed('cached-by-new-holder'),
      ]);
      expect(answer.executions).toBe(1);
    });

    it('takes over at most once, then times out', async () => {
      const acquires = { count: 0 };
      __setRefreshLockStoreForTests({
        ...store,
        tryAcquire: async () => {
          acquires.count += 1;

          return false;
        },
        isHeld: async () => false,
      } satisfies RefreshLockStore);
      const { calls: executions, execute } = countingExecute('fresh');

      const exit = await withLock({
        refreshToken: newToken(),
        execute,
        peek: neverPeek,
      });

      expect(failureOf(exit)).toBeInstanceOf(RefreshLockTimeout);
      expect(acquires.count).toBe(2);
      expect(executions.count).toBe(0);
    });

    it('extends the lock with heartbeats while execute runs', async () => {
      __setRefreshLockStoreForTests(store);
      const refreshToken = newToken();

      const pending = withLock({
        refreshToken,
        execute: () => Effect.sleep('3500 millis').pipe(Effect.as('done')),
        peek: neverPeek,
      });

      await sleep(500);
      const [early] = await lockExpiryMs(refreshToken);
      await sleep(2500);
      const [late] = await lockExpiryMs(refreshToken);

      await expect(pending).resolves.toStrictEqual(Exit.succeed('done'));
      expect(late - early).toBeGreaterThan(1500);
    }, 15_000);

    it('writes the transient marker with the release when execute marks it, even when execute fails', async () => {
      __setRefreshLockStoreForTests(store);
      const refreshToken = newToken();
      const failure = StepFailed.make({ step: 'upstream 5xx' });

      const exit = await withLock({
        refreshToken,
        execute: (release) =>
          release.markTransientForWaiters.pipe(
            Effect.andThen(Effect.fail(failure)),
          ),
        peek: neverPeek,
      });

      expect(exit).toStrictEqual(Exit.fail(failure));
      await expect(store.isHeld(refreshToken)).resolves.toBe(false);
      await expect(hasTransientFailure(refreshToken)).resolves.toBe(true);
    });

    it('writes no transient marker when execute does not mark it', async () => {
      __setRefreshLockStoreForTests(store);
      const refreshToken = newToken();
      const { execute } = countingExecute('ok');

      const exit = await withLock({ refreshToken, execute, peek: neverPeek });

      expect(exit).toStrictEqual(Exit.succeed('ok'));
      await expect(hasTransientFailure(refreshToken)).resolves.toBe(false);
    });

    it('returns the answer a holder wrote between the waiter peeking and checking the lock', async () => {
      __setRefreshLockStoreForTests(store);
      const refreshToken = newToken();
      await expect(store.tryAcquire(refreshToken, 'peer', 6000)).resolves.toBe(
        true,
      );
      const { calls: peeks, peek } = peekRacingRelease(refreshToken, 'peer');
      const { calls: executions, execute } = countingExecute('fresh');

      const exit = await withLock({ refreshToken, execute, peek });

      expect(exit).toStrictEqual(Exit.succeed('cached-by-peer'));
      expect(peeks.count).toBe(2);
      expect(executions.count).toBe(0);
    });
  });

  describe('hasTransientFailure', () => {
    it('is true while a transient marker is live', async () => {
      __setRefreshLockStoreForTests(store);
      const refreshToken = newToken();
      await store.markTransient(refreshToken, 30_000);

      await expect(hasTransientFailure(refreshToken)).resolves.toBe(true);
    });

    it('is false without a marker', async () => {
      __setRefreshLockStoreForTests(store);

      await expect(hasTransientFailure(newToken())).resolves.toBe(false);
    });

    it('is false when the store refuses connections', async () => {
      __setRefreshLockStoreForTests(
        createPostgresRefreshLockStore(refusingDatabaseUrl),
      );

      await expect(hasTransientFailure(newToken())).resolves.toBe(false);
    });

    it('is false without a store', async () => {
      __setRefreshLockStoreForTests(null);

      await expect(hasTransientFailure(newToken())).resolves.toBe(false);
    });
  });
});
