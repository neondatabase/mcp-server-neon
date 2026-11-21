import { Duration, Effect, Ref, Schedule } from 'effect';

/**
 * Runs `attempt` once plus once per delay while `retryable` holds, logging
 * every failed attempt in the format `retryAsync` has always logged, so
 * existing log queries keep matching. The last failure is returned.
 */
export const retryLogged = <A, E, R>(input: {
  readonly attempt: Effect.Effect<A, E, R>;
  readonly op: string;
  readonly delaysMs: readonly number[];
  readonly retryable: (error: E) => boolean;
  readonly describe: (error: E) => string;
}) =>
  Effect.gen(function* () {
    const { op, delaysMs, retryable } = input;
    const attempts = delaysMs.length + 1;
    const attempt = yield* Ref.make(0);

    const logFailure = (error: E) =>
      Ref.get(attempt).pipe(
        Effect.flatMap((n) =>
          Effect.logWarning(
            `retryAsync ${op} attempt ${n}/${attempts} failed`,
          ).pipe(
            Effect.annotateLogs({
              err: input.describe(error),
              isFinalAttempt: n === attempts,
              retryable: retryable(error),
            }),
          ),
        ),
      );

    return yield* Ref.update(attempt, (n) => n + 1).pipe(
      Effect.andThen(input.attempt),
      Effect.tapError(logFailure),
      Effect.retry({
        schedule: Schedule.recurs(delaysMs.length).pipe(
          Schedule.modifyDelay(({ attempt: retry }) =>
            Effect.succeed(Duration.millis(delaysMs[retry - 1] ?? 0)),
          ),
        ),
        while: retryable,
      }),
    );
  });
