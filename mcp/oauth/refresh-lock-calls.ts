import { Context, Effect, Ref, Schedule } from 'effect';
import {
  LOCK_HEARTBEAT_MS,
  LOCK_TTL_MS,
  TRANSIENT_TTL_MS,
} from './refresh-lock';
import type { RefreshLockStore } from './refresh-lock-store';
import { RefreshLockStoreFailed } from './refresh-lock-store-failed';
import { annotateStoreFallback, logStoreFallback } from './store-fallback';

/** One lock in one store, held under `owner`. */
type Owned = {
  readonly store: RefreshLockStore;
  readonly refreshToken: string;
  readonly owner: string;
};

export const storeCall = <A>(input: {
  readonly store: RefreshLockStore;
  readonly operation: string;
  readonly run: () => Promise<A>;
}) =>
  Effect.tryPromise({
    try: input.run,
    catch: (cause) =>
      RefreshLockStoreFailed.make({
        store: input.store.name,
        operation: input.operation,
        cause,
      }),
  });

export const logStoreWarning = (
  message: string,
  failure: RefreshLockStoreFailed,
) =>
  Effect.logWarning(message).pipe(
    Effect.annotateLogs({
      store: failure.store,
      err:
        failure.cause instanceof Error ? failure.cause.message : failure.cause,
    }),
  );

/** The store reads whose fallback the current lock wait already logged. */
export const LoggedFallbacks = Context.Reference<
  Ref.Ref<ReadonlySet<string>> | undefined
>(
  '@neondatabase/mcp-server-neon/mcp/oauth/refresh-lock-calls/LoggedFallbacks',
  {
    defaultValue: () => undefined,
  },
);

// A waiter's store reads fail on every poll while the store is down, so a
// lock wait logs each read's fallback once and annotates its span every time.
export const logFallbackOncePerWait = (
  message: string,
  failure: RefreshLockStoreFailed,
) =>
  Effect.gen(function* () {
    const logged = yield* LoggedFallbacks;

    if (logged === undefined) {
      return yield* logStoreFallback(message, failure);
    }

    const key = `${failure.store}:${failure.operation}`;

    const first = yield* Ref.modify(logged, (keys) => [
      !keys.has(key),
      new Set([...keys, key]),
    ]);

    yield* first
      ? logStoreFallback(message, failure)
      : annotateStoreFallback(failure);
  });

export const acquire = ({ store, refreshToken, owner }: Owned) =>
  storeCall({
    store,
    operation: 'acquire',
    run: async () => store.tryAcquire(refreshToken, owner, LOCK_TTL_MS),
  }).pipe(
    Effect.tap((acquired) =>
      Effect.annotateCurrentSpan('refresh_lock.acquired', acquired),
    ),
    Effect.withSpan('RefreshLock.acquire', {
      attributes: { 'refresh_lock.store': store.name },
    }),
  );

// Keeps the short TTL from expiring under a slow upstream call. A missed beat
// is logged: two in a row let the TTL lapse, which costs one waiter takeover,
// not a cliff.
export const heartbeat = ({ store, refreshToken, owner }: Owned) =>
  storeCall({
    store,
    operation: 'heartbeat',
    run: async () => store.extend(refreshToken, owner, LOCK_TTL_MS),
  }).pipe(
    Effect.withSpan('RefreshLock.heartbeat'),
    Effect.catchTag('RefreshLockStoreFailed', (failure) =>
      logStoreWarning('refresh-lock heartbeat failed', failure),
    ),
    Effect.schedule(Schedule.fixed(LOCK_HEARTBEAT_MS)),
  );

// A failed release is not fatal: the lock TTLs out within LOCK_TTL_MS.
export const release = Effect.fnUntraced(function* (
  owned: Owned & { readonly markTransient: Ref.Ref<boolean> },
) {
  const { store, refreshToken, owner } = owned;
  const markTransient = yield* Ref.get(owned.markTransient);

  yield* storeCall({
    store,
    operation: 'release',
    run: async () =>
      store.release(
        refreshToken,
        owner,
        markTransient ? TRANSIENT_TTL_MS : undefined,
      ),
  }).pipe(
    Effect.withSpan('RefreshLock.release', {
      attributes: {
        'refresh_lock.store': store.name,
        'refresh_lock.mark_transient': markTransient,
      },
    }),
    Effect.catchTag('RefreshLockStoreFailed', (failure) =>
      Effect.logWarning('refresh-lock release failed').pipe(
        Effect.annotateLogs({
          store: failure.store,
          err:
            failure.cause instanceof Error
              ? failure.cause.message
              : failure.cause,
          markTransient,
        }),
      ),
    ),
  );
});
