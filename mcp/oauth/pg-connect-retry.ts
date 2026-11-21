import type { Effect } from 'effect';
import { isPgConnectFailure } from './kv-store';
import { retryLogged } from './logged-retry';

const describe = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Retries a Postgres-bound store call once, 1.5 s later, when it failed to
 * connect: the OAuth database's compute suspends, and the first request after
 * the idle window can miss the wake-up. Idempotent calls only. Each failed
 * attempt is logged, so the SLO dashboards still see the blip when the retry
 * succeeds.
 */
export const retryPgConnect =
  (op: string) =>
  <A, E extends { readonly cause: unknown }, R>(
    attempt: Effect.Effect<A, E, R>,
  ) =>
    retryLogged({
      attempt,
      op,
      delaysMs: [1500],
      retryable: (error) => isPgConnectFailure(error.cause),
      describe: (error) => describe(error.cause),
    });
