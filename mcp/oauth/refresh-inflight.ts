import { Cause, Context, Deferred, Effect, Exit, Layer } from 'effect';
import type { RefreshError } from './refresh-failed';
import type { RefreshTokenResult } from './refresh-token-result';

type Pending = Deferred.Deferred<RefreshTokenResult, RefreshError>;

/**
 * Same-instance deduplication of refreshes: concurrent calls with the same
 * key share the first caller's refresh. Nothing is kept once it settles.
 */
export class RefreshInflight extends Context.Service<
  RefreshInflight,
  {
    /**
     * Runs `refresh`, or joins the one already running under `key`. A caller
     * interrupted before its refresh settled leaves the next waiter to run
     * it.
     */
    readonly dedupe: <R>(input: {
      readonly key: string;
      readonly refresh: Effect.Effect<RefreshTokenResult, RefreshError, R>;
    }) => Effect.Effect<RefreshTokenResult, RefreshError, R>;
  }
>()(
  '@neondatabase/mcp-server-neon/mcp/oauth/refresh-inflight/RefreshInflight',
  {
    make: Effect.sync(() => {
      const pending = new Map<string, Pending>();

      const lead = <R>(input: {
        readonly key: string;
        readonly refresh: Effect.Effect<RefreshTokenResult, RefreshError, R>;
      }) =>
        Effect.uninterruptibleMask((restore) =>
          Effect.suspend(() => {
            const settled: Pending = Deferred.makeUnsafe();

            pending.set(input.key, settled);

            return restore(input.refresh).pipe(
              Effect.onExit((exit) =>
                Effect.sync(() => pending.delete(input.key)).pipe(
                  Effect.andThen(Deferred.done(settled, exit)),
                ),
              ),
            );
          }),
        );

      const dedupe = <R>(input: {
        readonly key: string;
        readonly refresh: Effect.Effect<RefreshTokenResult, RefreshError, R>;
      }): Effect.Effect<RefreshTokenResult, RefreshError, R> =>
        Effect.suspend(() => {
          const running = pending.get(input.key);

          if (running === undefined) {
            return lead(input);
          }

          // A waiter's own interruption never reaches `exit`, so an
          // interrupt-only exit is the leader's.
          return Effect.exit(Deferred.await(running)).pipe(
            Effect.flatMap((exit) =>
              Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
                ? dedupe(input)
                : exit,
            ),
          );
        });

      return { dedupe };
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}
