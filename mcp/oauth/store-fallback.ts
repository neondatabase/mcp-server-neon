import { Effect, Option, Predicate, Schema } from 'effect';

type StoreFailure = {
  readonly store: string;
  readonly operation: string;
  readonly cause: unknown;
};

const errorCodeOf = Schema.decodeUnknownOption(
  Schema.Struct({ code: Schema.String }),
);

// Only the error's name and code: a store error's message can quote the
// refresh token it was looking up.
const describe = (cause: unknown) => ({
  errorName: Predicate.isError(cause) ? cause.name : 'unknown',
  errorCode: errorCodeOf(cause).pipe(Option.map(({ code }) => code)),
});

/** Records on the current span a store read answered with its fallback. */
export const annotateStoreFallback = ({
  store,
  operation,
  cause,
}: StoreFailure) => {
  const { errorName, errorCode } = describe(cause);

  return Effect.annotateCurrentSpan({
    'fallback.store': store,
    'fallback.operation': operation,
    'fallback.error': Option.getOrElse(errorCode, () => errorName),
  });
};

/**
 * Logs a store read that failed and was answered with its fallback, and
 * records it on the current span.
 */
export const logStoreFallback = (message: string, failure: StoreFailure) => {
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
    Effect.andThen(annotateStoreFallback(failure)),
  );
};
