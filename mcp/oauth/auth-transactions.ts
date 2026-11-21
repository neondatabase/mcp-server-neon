import { Context, Effect, Layer, Option } from 'effect';
import type {
  ApprovedAuthTransaction,
  AuthTransaction,
  PendingAuthTransaction,
} from './auth-transaction';
import { authTransactions } from './auth-transaction-store';
import { OAuthStoreUnavailable } from './oauth-store-unavailable';
import { retryPgConnect } from './pg-connect-retry';

type CreatePendingInput = Parameters<typeof authTransactions.createPending>[0];

type CreatedPending = Awaited<
  ReturnType<typeof authTransactions.createPending>
>;

type ApproveInput = Parameters<typeof authTransactions.approvePending>[0];

const transaction = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => OAuthStoreUnavailable.make({ operation, cause }),
  }).pipe(
    retryPgConnect(`authTx.${operation}`),
    Effect.withSpan(`AuthTransactions.${operation}`),
  );

const optional = <A>(operation: string, run: () => Promise<A | undefined>) =>
  transaction(operation, run).pipe(Effect.map(Option.fromUndefinedOr));

type Binding = { readonly id: string; readonly browserSecret: string };

/**
 * One authorization request from consent to callback, bound to the browser
 * that started it. Every lookup by browser secret fails closed: a wrong or
 * expired binding is `None`.
 */
export class AuthTransactions extends Context.Service<
  AuthTransactions,
  {
    readonly createPending: (
      input: CreatePendingInput,
    ) => Effect.Effect<CreatedPending, OAuthStoreUnavailable>;
    readonly getPending: (
      binding: Binding,
    ) => Effect.Effect<
      Option.Option<PendingAuthTransaction>,
      OAuthStoreUnavailable
    >;
    readonly approvePending: (
      input: ApproveInput,
    ) => Effect.Effect<
      Option.Option<ApprovedAuthTransaction>,
      OAuthStoreUnavailable
    >;
    readonly consumePending: (
      binding: Binding,
    ) => Effect.Effect<
      Option.Option<PendingAuthTransaction>,
      OAuthStoreUnavailable
    >;
    readonly consumeApproved: (
      binding: Binding,
    ) => Effect.Effect<
      Option.Option<ApprovedAuthTransaction>,
      OAuthStoreUnavailable
    >;
    /** Consumes a transaction in either state, for relaying an upstream error. */
    readonly consumeBound: (
      binding: Binding,
    ) => Effect.Effect<Option.Option<AuthTransaction>, OAuthStoreUnavailable>;
    readonly getById: (input: {
      readonly id: string;
    }) => Effect.Effect<Option.Option<AuthTransaction>, OAuthStoreUnavailable>;
  }
>()(
  '@neondatabase/mcp-server-neon/mcp/oauth/auth-transactions/AuthTransactions',
  {
    make: Effect.succeed({
      createPending: (input: CreatePendingInput) =>
        transaction('createPending', async () =>
          authTransactions.createPending(input),
        ),
      getPending: ({ id, browserSecret }: Binding) =>
        optional('getPending', async () =>
          authTransactions.getPending(id, browserSecret),
        ),
      approvePending: (input: ApproveInput) =>
        optional('approvePending', async () =>
          authTransactions.approvePending(input),
        ),
      consumePending: ({ id, browserSecret }: Binding) =>
        optional('consumePending', async () =>
          authTransactions.consumePending(id, browserSecret),
        ),
      consumeApproved: ({ id, browserSecret }: Binding) =>
        optional('consumeApproved', async () =>
          authTransactions.consumeApproved(id, browserSecret),
        ),
      consumeBound: ({ id, browserSecret }: Binding) =>
        optional('consumeBound', async () =>
          authTransactions.consumeBound(id, browserSecret),
        ),
      getById: ({ id }: { readonly id: string }) =>
        optional('getById', async () => authTransactions.getById(id)),
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}
