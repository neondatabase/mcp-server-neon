import { Duration, Effect, Exit, Ref, Schedule, Schema } from 'effect';
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

/** One attempt threw; `error` is what it threw, judged once by `shouldRetry`. */
class AttemptFailed extends Schema.TaggedError<
  AttemptFailed,
  { readonly brand: unique symbol }
>()('AttemptFailed', { error: Schema.Unknown, retryable: Schema.Boolean }) {}

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

    const once = Ref.updateAndGet(attempt, (n) => n + 1).pipe(
      Effect.flatMap((n) => Effect.annotateCurrentSpan('retry.attempts', n)),
      Effect.andThen(
        Effect.tryPromise({
          try: fn,
          catch: (error) =>
            AttemptFailed.make({
              error,
              retryable:
                options.shouldRetry === undefined || options.shouldRetry(error),
            }),
        }),
      ),
    );

    return yield* once.pipe(
      Effect.tapError((failure) =>
        Ref.get(attempt).pipe(
          Effect.tap((n) =>
            Effect.sync(() => {
              logger.warn(`retryAsync ${op} attempt ${n}/${attempts} failed`, {
                err:
                  failure.error instanceof Error
                    ? failure.error.message
                    : failure.error,
                isFinalAttempt: n === attempts,
                retryable: failure.retryable,
              });
            }),
          ),
        ),
      ),
      Effect.retry({
        schedule: delays(delaysMs),
        while: ({ retryable }) => retryable,
      }),
      Effect.catch(({ error }) => Effect.die(error)),
    );
  });

// The span records the attempts and the outcome but does not fail itself:
// whether a final failure is the server's is the caller's to decide.
const traced = <T>(fn: () => Promise<T>, options: RetryOptions) =>
  retrying(fn, options).pipe(
    Effect.exit,
    Effect.tap((exit) =>
      Effect.annotateCurrentSpan(
        'retry.outcome',
        Exit.isSuccess(exit) ? 'success' : 'failure',
      ),
    ),
    Effect.withSpan(`retryAsync ${options.op}`, {
      attributes: { 'retry.op': options.op },
    }),
    Effect.flatten,
  );

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

  return mcpRuntime.runPromise(traced(fn, opts));
}
