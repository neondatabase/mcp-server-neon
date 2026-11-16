import { NeonApiError } from '@neon/sdk';
import { toNeonEffectError } from '@neon/effect';
import type { NeonEffectError } from '@neon/effect';
import { waitUntil } from '@vercel/functions';
import { Cause, Effect, Option, Predicate, Schedule, Schema } from 'effect';
import { getApiKeys } from '../oauth/kv-store';
import type { ApiKeyRecord } from '../oauth/kv-store';
import { resolveAccountFromAuth } from '../server/account';
import { createNeonClient } from '../server/api';
import { logger } from '../utils/logger';

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
      Effect.sync(() => {
        logger.warn('API key cache read failed', { error: cause });

        return Option.none();
      }),
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
      Effect.sync(() => {
        logger.warn('API key cache write failed', { err: cause });
      }),
    ),
  );

// A dropped connection to the Neon API would otherwise answer 401 and send the
// client back through OAuth; the check is a read, so it is safe to resend.
const getAuthDetails = (neonClient: ReturnType<typeof createNeonClient>) =>
  Effect.tryPromise({
    try: async (signal) => neonClient.getAuthDetails({ signal }),
    catch: toNeonEffectError,
  }).pipe(
    Effect.retry({
      schedule: Schedule.exponential('200 millis').pipe(Schedule.jittered),
      times: 2,
      while: Predicate.isTagged('NeonNetworkError'),
    }),
  );

const verification = Effect.fnUntraced(function* (accessToken: string) {
  const neonClient = createNeonClient(accessToken);
  const { data: auth } = yield* getAuthDetails(neonClient);

  if (auth.auth_method === 'oauth') {
    return 'oauth' as const;
  }

  // Use shared account resolution with identify on cache miss
  const account = yield* Effect.tryPromise({
    try: async (signal) =>
      resolveAccountFromAuth(auth, neonClient, {
        identifyContext: { context: { authMethod: auth.auth_method } },
        signal,
      }),
    catch: toNeonEffectError,
  });

  const record: ApiKeyRecord = {
    apiKey: accessToken,
    authMethod: auth.auth_method,
    account,
  };

  const context = yield* Effect.context();

  waitUntil(cacheApiKey(record).pipe(Effect.runPromiseWith(context)));
  logger.info('API key cache miss, verified and cached', {
    accountId: account.id,
  });

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

  logger.error('API key verification failed', {
    message: failure instanceof Error ? failure.message : String(failure),
    status: failure instanceof NeonApiError ? failure.status : undefined,
    data: failure instanceof NeonApiError ? failure.body : undefined,
  });
};

// A key Neon rejects (4xx) or the SDK refuses is the caller's mistake.
const isCallerFailure = (error: NeonEffectError): boolean =>
  Predicate.isTagged(error, 'NeonClientError') ||
  ('status' in error && Predicate.isNumber(error.status) && error.status < 500);

// The span fails only when Neon or the network did; a rejected key keeps it ok.
const verifyApiKey = (accessToken: string) =>
  verification(accessToken).pipe(
    Effect.catchIf(isCallerFailure, (error) => {
      logVerificationFailure(Cause.fail(error));

      return Effect.succeed(null);
    }),
    Effect.withSpan('McpAuth.verifyApiKey'),
  );

/**
 * Resolves an API key's account, or reports `'oauth'` as soon as Neon says the
 * bearer is an OAuth token, before account resolution can fail it. `null` when
 * the key cannot be verified.
 */
export const fetchAccountDetails = (accessToken: string) =>
  Effect.gen(function* () {
    const cached = yield* cachedApiKey(accessToken);

    if (Option.isSome(cached)) {
      logger.info('API key cache hit', { accountId: cached.value.account.id });

      return cached.value.authMethod === 'oauth' ? 'oauth' : cached.value;
    }

    return yield* verifyApiKey(accessToken).pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterruptsOnly(cause),
        (cause) => {
          logVerificationFailure(cause);

          return Effect.succeed(null);
        },
      ),
    );
  });
