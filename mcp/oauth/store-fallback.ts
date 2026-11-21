import { Context, Effect, Option, Predicate, Ref, Schema } from 'effect';

type StoreFailure = {
  readonly store: string;
  readonly operation: string;
  readonly cause: unknown;
};

/** The store reads whose fallback the current scope already logged. */
const LoggedFallbacks = Context.Reference<
  Ref.Ref<ReadonlySet<string>> | undefined
>('@neondatabase/mcp-server-neon/mcp/oauth/store-fallback/LoggedFallbacks', {
  defaultValue: () => undefined,
});

const errorCodeOf = Schema.decodeUnknownOption(
  Schema.Struct({ code: Schema.String }),
);

// Only the error's name and code: a store error's message can quote the
// refresh token it was looking up.
const describe = (cause: unknown) => ({
  errorName: Predicate.isError(cause) ? cause.name : 'unknown',
  errorCode: errorCodeOf(cause).pipe(Option.map(({ code }) => code)),
});

const annotateStoreFallback = ({ store, operation, cause }: StoreFailure) => {
  const { errorName, errorCode } = describe(cause);

  return Effect.annotateCurrentSpan({
    'fallback.store': store,
    'fallback.operation': operation,
    'fallback.error': Option.getOrElse(errorCode, () => errorName),
  });
};

const warn = (message: string, failure: StoreFailure) => {
  const { store, operation, cause } = failure;
  const { errorName, errorCode } = describe(cause);
  const fields = { store, operation, errorName };

  return Effect.logWarning(message).pipe(
    Effect.annotateLogs(
      Option.match(errorCode, {
        onNone: () => fields,
        onSome: (code) => ({ ...fields, errorCode: code }),
      }),
    ),
  );
};

const firstInScope = (failure: StoreFailure) =>
  Effect.gen(function* () {
    const logged = yield* LoggedFallbacks;

    if (logged === undefined) {
      return true;
    }

    const key = `${failure.store}:${failure.operation}`;

    return yield* Ref.modify(logged, (keys) => [
      !keys.has(key),
      new Set([...keys, key]),
    ]);
  });

/**
 * Records on the current span a store read that failed and was answered with
 * its fallback, and logs it unless this `logFallbacksOnce` scope already
 * logged the same store and operation.
 */
export const logStoreFallback = (message: string, failure: StoreFailure) =>
  firstInScope(failure).pipe(
    Effect.flatMap((first) => (first ? warn(message, failure) : Effect.void)),
    Effect.andThen(annotateStoreFallback(failure)),
  );

/**
 * Runs `effect` logging each store read's fallback once. A store outage fails
 * the same reads on every lock poll, so a request would otherwise log them
 * dozens of times. Nested scopes share the outermost one's record.
 */
export const logFallbacksOnce = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const outer = yield* LoggedFallbacks;

    if (outer !== undefined) {
      return yield* effect;
    }

    const logged = yield* Ref.make<ReadonlySet<string>>(new Set());

    return yield* effect.pipe(Effect.provideService(LoggedFallbacks, logged));
  });
