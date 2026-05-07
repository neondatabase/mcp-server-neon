import { logger } from './logger';

/**
 * Retry an async operation with explicit per-attempt delays. Stops on first
 * success; throws the last error on final failure.
 *
 * Designed for short retry budgets on transient errors (Postgres connection
 * blips, network hiccups). Don't use this for things that should fail fast.
 *
 * @param fn               Operation to retry. Should be idempotent.
 * @param opts.attempts    Total attempts including the first try.
 * @param opts.delaysMs    Delays between attempts. Length must be `attempts - 1`.
 * @param opts.op          Short label included in retry/abort log lines.
 * @param opts.shouldRetry Optional predicate. If supplied and returns false
 *                         for the thrown error, the error propagates
 *                         immediately instead of being retried. Useful when
 *                         only specific error categories are retryable.
 */
export async function retryAsync<T>(
  fn: () => Promise<T>,
  opts: {
    attempts: number;
    delaysMs: number[];
    op: string;
    shouldRetry?: (err: unknown) => boolean;
  },
): Promise<T> {
  const { attempts, delaysMs, op, shouldRetry } = opts;
  if (delaysMs.length !== attempts - 1) {
    throw new Error(
      `retryAsync misconfigured: ${attempts} attempts requires ${attempts - 1} delays, got ${delaysMs.length}`,
    );
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isFinalAttempt = attempt === attempts - 1;
      const retryable = shouldRetry === undefined || shouldRetry(err);
      logger.warn(
        `retryAsync ${op} attempt ${attempt + 1}/${attempts} failed`,
        {
          err: err instanceof Error ? err.message : err,
          isFinalAttempt,
          retryable,
        },
      );
      if (!retryable) throw err;
      if (isFinalAttempt) break;
      const delayMs = delaysMs[attempt];
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, delayMs);
        t.unref?.();
      });
    }
  }
  throw lastError;
}
