import { Effect, Exit, Fiber, ManagedRuntime } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';
import { isPgConnectFailure } from '../oauth/kv-store';
import { OAuthStoreUnavailable } from '../oauth/oauth-store-unavailable';
import { retryPgConnect } from '../oauth/pg-connect-retry';

// These pin the predicate / retry helper contract that the /callback
// hot-path depends on. Regression for the 2026-05-12 OAUTH_DATABASE_URL
// compute scale-from-zero hiccup where `internal_error` failures were both
// undebuggable (no clientId in SLO) and unmasked (no retry against the
// freshly-woken compute).

describe('isPgConnectFailure', () => {
  it('matches Postgres XX000 by code', () => {
    const err = Object.assign(new Error("Couldn't connect to compute node"), {
      code: 'XX000',
    });
    expect(isPgConnectFailure(err)).toBe(true);
  });

  it.each([
    ['password authentication failed for user "mcp"'],
    ['terminating connection due to administrator command'],
    ['Connection terminated unexpectedly'],
    ['read ECONNRESET'],
    ['connect ECONNREFUSED 10.0.0.1:5432'],
    ['connect ETIMEDOUT'],
    ['getaddrinfo ENOTFOUND ep-xyz.neon.tech'],
  ])('matches %s', (msg) => {
    expect(isPgConnectFailure(new Error(msg))).toBe(true);
  });

  it.each([
    ['relation "mcpauth.tokens" does not exist'],
    ['permission denied for schema mcpauth'],
    ['invalid input syntax for type json'],
    ['duplicate key value violates unique constraint'],
  ])('does NOT match %s', (msg) => {
    expect(isPgConnectFailure(new Error(msg))).toBe(false);
  });

  it('does NOT match unrelated errors', () => {
    expect(isPgConnectFailure(new Error('not a pg error'))).toBe(false);
    expect(
      isPgConnectFailure(
        Object.assign(new Error('check failed'), { code: '23505' }),
      ),
    ).toBe(false);
    expect(isPgConnectFailure(undefined)).toBe(false);
    expect(isPgConnectFailure(null)).toBe(false);
    expect(isPgConnectFailure('string error')).toBe(false);
  });
});

describe('retryPgConnect', () => {
  const xx000 = Object.assign(new Error("Couldn't connect"), { code: 'XX000' });

  const storeCall = (results: (string | Error)[]) => {
    let calls = 0;

    const attempt = Effect.suspend(() => {
      const result = results[calls] ?? results.at(-1);

      calls += 1;

      return result instanceof Error
        ? Effect.fail(
            OAuthStoreUnavailable.make({ operation: 'op', cause: result }),
          )
        : Effect.succeed(result);
    });

    return { attempt, calls: () => calls };
  };

  const runtime = ManagedRuntime.make(TestClock.layer());

  const run = async <A, E>(effect: Effect.Effect<A, E>) =>
    runtime.runPromiseExit(effect);

  it('returns the value on first success without retrying', async () => {
    const call = storeCall(['ok']);
    const exit = await run(call.attempt.pipe(retryPgConnect('test.op')));

    expect(exit).toStrictEqual(Exit.succeed('ok'));
    expect(call.calls()).toBe(1);
  });

  it('retries once on XX000 and succeeds on the second attempt', async () => {
    const call = storeCall([xx000, 'ok']);

    const exit = await run(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          call.attempt.pipe(retryPgConnect('test.op')),
        );

        yield* TestClock.adjust('1500 millis');

        return yield* Fiber.join(fiber);
      }),
    );

    expect(exit).toStrictEqual(Exit.succeed('ok'));
    expect(call.calls()).toBe(2);
  });

  it('fails after both attempts on persistent XX000', async () => {
    const call = storeCall([xx000]);

    const exit = await run(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          call.attempt.pipe(retryPgConnect('test.op')),
        );

        yield* TestClock.adjust('1500 millis');

        return yield* Fiber.join(fiber);
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(call.calls()).toBe(2);
  });

  it('does not retry an error that is not a connect failure', async () => {
    const call = storeCall([new Error('logic bug')]);
    const exit = await run(call.attempt.pipe(retryPgConnect('test.op')));

    expect(Exit.isFailure(exit)).toBe(true);
    expect(call.calls()).toBe(1);
  });
});
