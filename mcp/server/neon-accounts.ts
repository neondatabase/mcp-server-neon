import { createNeonClient, raw } from '@neon/sdk';
import type { AuthDetailsResponse } from '@neon/sdk';
import { make, toNeonEffectError } from '@neon/effect';
import type { NeonEffectError } from '@neon/effect';
import { Context, Effect, Layer, Predicate, Redacted, Result } from 'effect';
import { NEON_API_HOST } from '../constants';
import { fetchAsMcpServer } from '../neon-client';
import {
  isProjectScopedKeyRejection,
  orgAccount,
  projectScopedAccount,
  projectScopedFallbackBreadcrumb,
  selectOrganization,
  userAccount,
} from './account';
import type { NeonAccount } from './account';
import { NoDefaultOrganization } from './no-default-organization';

type Credentials = { readonly apiKey: Redacted.Redacted };

type OrganizationQuery = Credentials & {
  readonly account: { readonly id: string; readonly isOrg?: boolean };
  readonly orgId: string | undefined;
};

type AccountsError = NeonEffectError | NoDefaultOrganization;

const clientConfig = (apiKey: Redacted.Redacted) => ({
  apiKey: Redacted.value(apiKey),
  baseUrl: NEON_API_HOST,
  fetch: fetchAsMcpServer,
});

// Throws on an invalid key, inside the Effect that calls it, as a defect.
const effectClient = (apiKey: Redacted.Redacted) => {
  const config = clientConfig(apiKey);

  return make(config);
};

// `@neon/effect` drops the SDK's raw client, and auth details and the org read
// have only raw calls; these go through `toNeonEffectError` like its methods.
const rawCall = <A>(
  apiKey: Redacted.Redacted,
  call: (
    client: ReturnType<typeof createNeonClient>['client'],
    signal: AbortSignal,
  ) => Promise<A>,
) =>
  Effect.tryPromise({
    try: async (signal) =>
      call(
        createNeonClient({ ...clientConfig(apiKey), throwOnError: true })
          .client,
        signal,
      ),
    catch: toNeonEffectError,
  });

/** A key Neon rejects (4xx) or a call the SDK refuses is the caller's mistake. */
export const isNeonCallerMistake = (error: NeonEffectError): boolean =>
  Predicate.isTagged(error, 'NeonClientError') ||
  ('status' in error && Predicate.isNumber(error.status) && error.status < 500);

/**
 * Ends the span ok for a caller's mistake, with `error.type` set, and still
 * fails with it outside the span.
 */
const answeredInSpan =
  <E extends AccountsError>(name: string, isMistake: (error: E) => boolean) =>
  <A, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    effect.pipe(
      Effect.map(Result.succeed),
      Effect.catchIf(isMistake, (error) =>
        Effect.annotateCurrentSpan('error.type', error._tag).pipe(
          Effect.as(Result.fail(error)),
        ),
      ),
      Effect.withSpan(name),
      Effect.flatMap(Effect.fromResult),
    );

const authDetails = ({ apiKey }: Credentials) =>
  rawCall(apiKey, async (client, signal) =>
    raw.getAuthDetails({ client, throwOnError: true, signal }),
  ).pipe(answeredInSpan('NeonAccounts.authDetails', isNeonCallerMistake));

const accountLookup = (apiKey: Redacted.Redacted, auth: AuthDetailsResponse) =>
  auth.auth_method === 'api_key_org'
    ? rawCall(apiKey, async (client, signal) =>
        raw.getOrganization({
          client,
          path: { org_id: auth.account_id },
          throwOnError: true,
          signal,
        }),
      ).pipe(Effect.map((org) => orgAccount(auth.account_id, org.name)))
    : Effect.suspend(() => effectClient(apiKey).user.me()).pipe(
        Effect.map(userAccount),
      );

const isProjectScopedKeyError = (error: NeonEffectError): boolean =>
  'status' in error &&
  Predicate.isNumber(error.status) &&
  'body' in error &&
  isProjectScopedKeyRejection({ status: error.status, body: error.body });

const projectScopedFallback = (auth: AuthDetailsResponse) =>
  Effect.logDebug('Using project-scoped API key fallback').pipe(
    Effect.annotateLogs({ account_id: auth.account_id }),
    Effect.andThen(
      Effect.sync(() => {
        projectScopedFallbackBreadcrumb(auth);
      }),
    ),
    Effect.andThen(
      Effect.annotateCurrentSpan('neon.account.project_scoped_key', true),
    ),
    Effect.as(projectScopedAccount(auth.account_id)),
  );

const account = ({
  apiKey,
  auth,
}: Credentials & { readonly auth: AuthDetailsResponse }) =>
  accountLookup(apiKey, auth).pipe(
    Effect.catchIf(isProjectScopedKeyError, () => projectScopedFallback(auth)),
    answeredInSpan('NeonAccounts.account', isNeonCallerMistake),
  );

const listedOrganization = ({
  apiKey,
  account: { id, isOrg },
  orgId,
}: OrganizationQuery) => {
  if (orgId !== undefined) {
    return Effect.succeed({ id: orgId });
  }

  if (isOrg === true) {
    return Effect.succeed({ id });
  }

  return Effect.suspend(() => effectClient(apiKey).user.organizations()).pipe(
    Effect.flatMap((organizations) =>
      Result.match(selectOrganization(organizations), {
        onSuccess: Effect.succeed,
        onFailure: (message) =>
          Effect.fail(NoDefaultOrganization.make({ message })),
      }),
    ),
  );
};

const organization = (query: OrganizationQuery) =>
  listedOrganization(query).pipe(
    answeredInSpan(
      'NeonAccounts.organization',
      (error: AccountsError) =>
        Predicate.isTagged(error, 'NoDefaultOrganization') ||
        isNeonCallerMistake(error),
    ),
  );

/**
 * The Neon API calls the transport makes outside tools, each with the caller's
 * key. Interrupting a call aborts its request; requests carry the server's
 * User-Agent. A key Neon rejects keeps the span ok with `error.type` set.
 */
export class NeonAccounts extends Context.Service<
  NeonAccounts,
  {
    /** How the key authenticates and which account it belongs to. */
    readonly authDetails: (
      input: Credentials,
    ) => Effect.Effect<AuthDetailsResponse, NeonEffectError>;
    /**
     * The account behind auth details. A project-scoped key, which cannot read
     * its account, gets a placeholder account with the key's account id.
     */
    readonly account: (
      input: Credentials & { readonly auth: AuthDetailsResponse },
    ) => Effect.Effect<NeonAccount, NeonEffectError>;
    /**
     * The organization a project call runs in: `orgId` when given, the org of
     * an org key, else the account's only (console-managed) organization.
     */
    readonly organization: (
      input: OrganizationQuery,
    ) => Effect.Effect<
      { readonly id: string },
      NeonEffectError | NoDefaultOrganization
    >;
  }
>()('@neondatabase/mcp-server-neon/mcp/server/neon-accounts/NeonAccounts', {
  make: Effect.succeed({ authDetails, account, organization }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
