import { logger } from './logger';

/**
 * Retry an async operation with explicit per-attempt delays. Stops on first
 * success; throws the last error on final failure.
 *
 * Designed for short retry budgets on transient errors (Postgres connection
 * blips, network hiccups). Don't use this for things that should fail fast.
 *
 * @param fn          Operation to retry. Should be idempotent.
 * @param opts.attempts  Total attempts including the first try.
 * @param opts.delaysMs  Delays between attempts. Length must be `attempts - 1`.
 * @param opts.op     Short label included in retry/abort log lines.
 */
export async function retryAsync<T>(
  fn: () => Promise<T>,
  opts: { attempts: number; delaysMs: number[]; op: string },
): Promise<T> {
  const { attempts, delaysMs, op } = opts;
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
      logger.warn(
        `retryAsync ${op} attempt ${attempt + 1}/${attempts} failed`,
        {
          err: err instanceof Error ? err.message : err,
          isFinalAttempt,
        },
      );
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
