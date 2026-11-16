import { Duration, Effect, Ref, Schedule, Schema } from 'effect';
import { mcpRuntime } from '../../lib/effect/runtime';
import { logger } from './logger';

type RetryOptions = {
  /** Total attempts including the first try. */
  attempts: number;
  /** Delays between attempts. Length must be `attempts - 1`. */
  delaysMs: number[];
  /** Short label included in retry/abort log lines. */
  op: string;
  /**
   * If supplied and false for the thrown error, the error propagates
   * immediately instead of being retried.
   */
  shouldRetry?: (err: unknown) => boolean;
};

/** One attempt threw; `error` is what it threw. */
class AttemptFailed extends Schema.TaggedError<
  AttemptFailed,
  { readonly brand: unique symbol }
>()('AttemptFailed', { error: Schema.Unknown }) {}

const isRetryable = (
  { shouldRetry }: RetryOptions,
  { error }: AttemptFailed,
): boolean => shouldRetry === undefined || shouldRetry(error);

const delays = (delaysMs: readonly number[]) =>
  Schedule.recurs(delaysMs.length).pipe(
    Schedule.modifyDelay(({ attempt }) =>
      Effect.succeed(Duration.millis(delaysMs[attempt - 1] ?? 0)),
    ),
  );

const retrying = <T>(fn: () => Promise<T>, options: RetryOptions) =>
  Effect.gen(function* () {
    const { attempts, delaysMs, op } = options;
    const attempt = yield* Ref.make(0);

    return yield* Effect.tryPromise({
      try: fn,
      catch: (error) => AttemptFailed.make({ error }),
    }).pipe(
      Effect.tapError((failure) =>
        Ref.updateAndGet(attempt, (n) => n + 1).pipe(
          Effect.tap((n) =>
            Effect.sync(() => {
              logger.warn(`retryAsync ${op} attempt ${n}/${attempts} failed`, {
                err:
                  failure.error instanceof Error
                    ? failure.error.message
                    : failure.error,
                isFinalAttempt: n === attempts,
                retryable: isRetryable(options, failure),
              });
            }),
          ),
        ),
      ),
      Effect.retry({
        schedule: delays(delaysMs),
        while: (failure) => isRetryable(options, failure),
      }),
      Effect.catch(({ error }) => Effect.die(error)),
    );
  });

/**
 * Retry an async operation with explicit per-attempt delays. Stops on first
 * success; throws the last error on final failure.
 *
 * Designed for short retry budgets on transient errors (Postgres connection
 * blips, network hiccups). Don't use this for things that should fail fast.
 * `fn` should be idempotent.
 */
export async function retryAsync<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const { attempts, delaysMs } = opts;

  if (delaysMs.length !== attempts - 1) {
    throw new Error(
      `retryAsync misconfigured: ${attempts} attempts requires ${attempts - 1} delays, got ${delaysMs.length}`,
    );
  }

  return mcpRuntime.runPromise(retrying(fn, opts));
}
