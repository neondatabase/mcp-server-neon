import { randomUUID } from 'node:crypto';
import { Clock, Context, Effect, Fiber, Layer, Option, Ref } from 'effect';
import {
  LOCK_POLL_INTERVAL_MS,
  LOCK_POLL_MAX_ATTEMPTS,
  WAITER_TOTAL_BUDGET_MS,
  peekTransientFailure,
  refreshLockStores,
} from './refresh-lock';
import {
  acquire,
  heartbeat,
  logStoreWarning,
  release,
  storeCall,
} from './refresh-lock-calls';
import type { RefreshLockStore } from './refresh-lock-store';
import { RefreshLockStoreFailed } from './refresh-lock-store-failed';
import { RefreshLockTimeout } from './refresh-lock-timeout';

/** What the lock holder can ask of its release. */
export type ReleaseHint = {
  /**
   * The release also writes the transient-failure marker, in the same atomic
   * operation, so waiters stop waiting on an upstream that is failing.
   */
  readonly markTransientForWaiters: Effect.Effect<void>;
};

type Locked<A, E, R> = {
  readonly store: RefreshLockStore;
  readonly refreshToken: string;
  readonly markTransient: Ref.Ref<boolean>;
  readonly inner: Effect.Effect<A, E, R>;
  readonly peek: Effect.Effect<Option.Option<A>, E, R>;
};

type Attempt<A, E, R> = Locked<A, E, R> & {
  readonly deadline: number;
  readonly takeoverAttempted: boolean;
};

const timedOut = Effect.annotateCurrentSpan(
  'refresh_lock.outcome',
  'timed_out',
).pipe(Effect.andThen(Effect.fail(RefreshLockTimeout.make({}))));

/**
 * Polls `peek` while another owner holds the lock. Some is a resolution, None
 * means the lock disappeared without one (the holder released or vanished).
 */
const poll = <A, E, R>(
  input: Attempt<A, E, R>,
  round: number,
): Effect.Effect<Option.Option<A>, E | RefreshLockTimeout, R> =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;

    if (round >= LOCK_POLL_MAX_ATTEMPTS || now >= input.deadline) {
      return yield* timedOut;
    }

    yield* Effect.sleep(LOCK_POLL_INTERVAL_MS);

    const cached = yield* input.peek;

    if (Option.isSome(cached)) {
      return cached;
    }

    const { store, refreshToken } = input;

    // A failed read keeps the waiter on the cache instead of stampeding
    // upstream.
    const held = yield* storeCall({
      store,
      operation: 'isHeld',
      run: async () => store.isHeld(refreshToken),
    }).pipe(Effect.option);

    if (Option.getOrElse(held, () => true)) {
      return yield* poll(input, round + 1);
    }

    // The holder may have written its result between the peek above and the
    // lock check, so one final peek closes that race.
    return yield* input.peek;
  });

// A peek that finds the refresh token's answer, even a failure, is the wait
// succeeding, so the span stays ok and the failure is returned after it.
const wait = <A, E, R>(input: Attempt<A, E, R>) =>
  poll(input, 0).pipe(
    Effect.tap((resolution) =>
      Effect.annotateCurrentSpan(
        'refresh_lock.outcome',
        Option.isSome(resolution) ? 'resolved' : 'released',
      ),
    ),
    Effect.result,
    Effect.withSpan('RefreshLock.wait', {
      attributes: {
        'refresh_lock.store': input.store.name,
        'refresh_lock.takeover': input.takeoverAttempted,
      },
    }),
    Effect.flatMap(Effect.fromResult),
  );

// A peer may have released after writing its result and before our acquire
// landed, so the holder peeks once before running.
const holderWork = <A, E, R>(input: Attempt<A, E, R>) =>
  Effect.gen(function* () {
    const fast = yield* input.peek;

    if (Option.isSome(fast)) {
      return fast.value;
    }

    if (input.takeoverAttempted) {
      yield* Effect.logInfo(
        'refresh-lock waiter took over after holder vanished',
      ).pipe(Effect.annotateLogs({ store: input.store.name }));
    }

    return yield* input.inner;
  });

/**
 * Takes `store`'s lock or waits on it. A holder heartbeats and releases even
 * when interrupted; a waiter takes over once if the lock disappears without
 * a result; an unreachable store runs `inner` directly.
 */
const attempt = <A, E, R>(
  input: Attempt<A, E, R>,
): Effect.Effect<A, E | RefreshLockTimeout, R> =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;

      if (now >= input.deadline) {
        return yield* RefreshLockTimeout.make({});
      }

      const owned = { ...input, owner: randomUUID() };

      const acquired = yield* acquire(owned).pipe(
        Effect.asSome,
        Effect.catchTag('RefreshLockStoreFailed', (failure) =>
          logStoreWarning(
            'refresh-lock acquire failed, falling back to direct execute',
            failure,
          ).pipe(Effect.as(Option.none())),
        ),
      );

      if (Option.isNone(acquired)) {
        return yield* restore(input.inner);
      }

      if (acquired.value) {
        const beating = yield* Effect.forkChild(heartbeat(owned));

        return yield* restore(holderWork(input)).pipe(
          Effect.ensuring(
            Fiber.interrupt(beating).pipe(Effect.andThen(release(owned))),
          ),
        );
      }

      const polled = yield* restore(wait(input));

      if (Option.isSome(polled)) {
        return polled.value;
      }

      if (input.takeoverAttempted) {
        return yield* RefreshLockTimeout.make({});
      }

      return yield* restore(attempt({ ...input, takeoverAttempted: true }));
    }),
  );

const locked = <A, E, R>(input: Locked<A, E, R>) =>
  Clock.currentTimeMillis.pipe(
    Effect.flatMap((now) =>
      attempt({
        ...input,
        deadline: now + WAITER_TOTAL_BUDGET_MS,
        takeoverAttempted: false,
      }),
    ),
  );

/** The cross-instance refresh-token lock over the configured stores. */
export class RefreshLock extends Context.Service<
  RefreshLock,
  {
    /**
     * Runs `execute` while holding the lock on `refreshToken` in every
     * configured store, outermost first. A caller that finds it held polls
     * `peek` until it finds the token's answer, takes over once if the lock
     * disappears without one, and otherwise fails with `RefreshLockTimeout`
     * after about 8 s. A store that can't be reached is skipped; with none
     * configured, `execute` runs directly. `peek` must be cheap and
     * idempotent.
     */
    readonly withLock: <A, E1, R1, E2, R2>(input: {
      readonly refreshToken: string;
      readonly execute: (release: ReleaseHint) => Effect.Effect<A, E1, R1>;
      readonly peek: Effect.Effect<Option.Option<A>, E2, R2>;
    }) => Effect.Effect<A, E1 | E2 | RefreshLockTimeout, R1 | R2>;
    /** Whether a holder recently marked this token's upstream as failing. */
    readonly hasTransientFailure: (input: {
      readonly refreshToken: string;
    }) => Effect.Effect<boolean>;
  }
>()(
  '@neondatabase/mcp-server-neon/mcp/oauth/refresh-lock-service/RefreshLock',
  {
    make: Effect.succeed({
      withLock: <A, E1, R1, E2, R2>(input: {
        readonly refreshToken: string;
        readonly execute: (release: ReleaseHint) => Effect.Effect<A, E1, R1>;
        readonly peek: Effect.Effect<Option.Option<A>, E2, R2>;
      }) =>
        Effect.gen(function* () {
          const { refreshToken, peek } = input;
          const stores = refreshLockStores();
          const markTransient = yield* Ref.make(false);

          const execute = input.execute({
            markTransientForWaiters: Ref.set(markTransient, true),
          });

          if (stores.length === 0) {
            yield* Effect.logWarning(
              'refresh-lock unavailable (no KV_URL or OAUTH_DATABASE_URL), falling back to direct execute',
            );

            return yield* execute;
          }

          return yield* stores.reduceRight<
            Effect.Effect<A, E1 | E2 | RefreshLockTimeout, R1 | R2>
          >(
            (inner, store) =>
              locked({ store, refreshToken, markTransient, inner, peek }),
            execute,
          );
        }),

      // Store errors count as no marker, so the waiter keeps polling.
      hasTransientFailure: ({
        refreshToken,
      }: {
        readonly refreshToken: string;
      }) =>
        Effect.tryPromise({
          try: async () => peekTransientFailure(refreshToken),
          catch: (cause) =>
            RefreshLockStoreFailed.make({
              store: 'all',
              operation: 'hasTransient',
              cause,
            }),
        }).pipe(
          Effect.catchTag('RefreshLockStoreFailed', () =>
            Effect.succeed(false),
          ),
          Effect.withSpan('RefreshLock.hasTransientFailure'),
        ),
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}
