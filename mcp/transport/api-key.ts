import { NeonApiError } from '@neon/sdk';
import { waitUntil } from '@vercel/functions';
import {
  Cause,
  Effect,
  Option,
  Predicate,
  Redacted,
  Schedule,
  Schema,
} from 'effect';
import { Analytics } from '../analytics/analytics-service';
import { getApiKeys } from '../oauth/kv-store';
import type { ApiKeyRecord } from '../oauth/kv-store';
import { isNeonCallerMistake, NeonAccounts } from '../server/neon-accounts';
import { ApiKeyVerificationUnavailable } from './api-key-unavailable';

/** The API-key cache could not be read or written. */
class ApiKeyCacheFailed extends Schema.TaggedError<
  ApiKeyCacheFailed,
  { readonly brand: unique symbol }
>()('ApiKeyCacheFailed', { cause: Schema.Unknown }) {}

// Cache TTL for API key verification (5 minutes)
// Balances security (revoked keys stop working soon) with performance (reduce API calls)
const API_KEY_CACHE_TTL_MS = 5 * 60 * 1000;

const cachedApiKey = (accessToken: string) =>
  Effect.tryPromise({
    try: async () => getApiKeys().get(accessToken),
    catch: (cause) => ApiKeyCacheFailed.make({ cause }),
  }).pipe(
    Effect.map(Option.fromNullishOr),
    Effect.catch(({ cause }) =>
      Effect.logWarning('API key cache read failed').pipe(
        Effect.annotateLogs({ error: cause }),
        Effect.as(Option.none()),
      ),
    ),
  );

// The response does not wait for the write; `waitUntil` keeps the function
// alive until it settles.
const cacheApiKey = (record: ApiKeyRecord) =>
  Effect.tryPromise({
    try: async () =>
      getApiKeys().set(record.apiKey, record, API_KEY_CACHE_TTL_MS),
    catch: (cause) => ApiKeyCacheFailed.make({ cause }),
  }).pipe(
    Effect.catch(({ cause }) =>
      Effect.logWarning('API key cache write failed').pipe(
        Effect.annotateLogs({ err: cause }),
      ),
    ),
  );

const verification = Effect.fnUntraced(function* (accessToken: string) {
  const accounts = yield* NeonAccounts;
  const apiKey = Redacted.make(accessToken);

  // A dropped connection to the Neon API would otherwise answer 401 and send
  // the client back through OAuth; the check is a read, so it is safe to resend.
  const auth = yield* accounts.authDetails({ apiKey }).pipe(
    Effect.retry({
      schedule: Schedule.exponential('200 millis').pipe(Schedule.jittered),
      times: 2,
      while: Predicate.isTagged('NeonNetworkError'),
    }),
  );

  if (auth.auth_method === 'oauth') {
    return 'oauth' as const;
  }

  const account = yield* accounts.account({ apiKey, auth });
  const analytics = yield* Analytics;

  yield* analytics.identify({
    account,
    params: { context: { authMethod: auth.auth_method } },
  });

  const record: ApiKeyRecord = {
    apiKey: accessToken,
    authMethod: auth.auth_method,
    account,
  };

  const context = yield* Effect.context();

  waitUntil(cacheApiKey(record).pipe(Effect.runPromiseWith(context)));
  yield* Effect.logInfo('API key cache miss, verified and cached').pipe(
    Effect.annotateLogs({ accountId: account.id }),
  );

  return record;
});

const thrownBy = (cause: Cause.Cause<{ readonly cause: unknown }>) =>
  Option.match(Cause.findErrorOption(cause), {
    onNone: () => Cause.squash(cause),
    onSome: (error) => error.cause,
  });

const logVerificationFailure = (
  cause: Cause.Cause<{ readonly cause: unknown }>,
) => {
  const failure = thrownBy(cause);

  return Effect.logError('API key verification failed').pipe(
    Effect.annotateLogs({
      message: failure instanceof Error ? failure.message : String(failure),
      status: failure instanceof NeonApiError ? failure.status : undefined,
      data: failure instanceof NeonApiError ? failure.body : undefined,
    }),
  );
};

// The span fails only when Neon or the network did; a rejected key keeps it ok.
const verifyApiKey = (accessToken: string) =>
  verification(accessToken).pipe(
    Effect.catchIf(isNeonCallerMistake, (error) =>
      logVerificationFailure(Cause.fail(error)).pipe(Effect.as(null)),
    ),
    Effect.withSpan('McpAuth.verifyApiKey'),
  );

/**
 * Resolves an API key's account, or reports `'oauth'` as soon as Neon says the
 * bearer is an OAuth token, before account resolution can fail it. `null` when
 * Neon rejects the key; `ApiKeyVerificationUnavailable` when Neon could not
 * be reached or verification broke.
 */
export const fetchAccountDetails = (accessToken: string) =>
  Effect.gen(function* () {
    const cached = yield* cachedApiKey(accessToken);

    if (Option.isSome(cached)) {
      yield* Effect.logInfo('API key cache hit').pipe(
        Effect.annotateLogs({ accountId: cached.value.account.id }),
      );

      return cached.value.authMethod === 'oauth' ? 'oauth' : cached.value;
    }

    return yield* verifyApiKey(accessToken).pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterruptsOnly(cause),
        (cause) =>
          logVerificationFailure(cause).pipe(
            Effect.andThen(
              Effect.fail(
                ApiKeyVerificationUnavailable.make({
                  cause: Cause.squash(cause),
                }),
              ),
            ),
          ),
      ),
    );
  });
