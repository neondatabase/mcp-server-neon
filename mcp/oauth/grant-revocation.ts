import { Effect } from 'effect';
import { OAuthStoreUnavailable } from './oauth-store-unavailable';
import { stored } from './stored';
import { retireDeniedGrant } from './grant-retirement';
import { resolveDeniedGrant } from './grant-revocation-store';
import { model } from './model';
import { getOwnedRotation } from './refresh-result';
import {
  traceGrant,
  accessGrantAlias,
  refreshGrantAlias,
} from './grant-family';
import type { GrantReference, GrantLineage } from './grant-family';

const refreshReference = async (
  presented: string,
  clientId: string,
): Promise<GrantReference | undefined> => {
  const refresh = await model.getRefreshToken(presented);

  if (refresh !== undefined) {
    const token = await model.getStoredAccessToken(refresh.accessToken);

    if (token !== undefined) {
      return token.client.id === clientId
        ? { clientId, token, refreshToken: presented }
        : undefined;
    }

    if (refresh.clientId === clientId) {
      return { clientId, refreshToken: presented };
    }
  }

  const rotation = await getOwnedRotation(presented, clientId);

  return rotation === undefined
    ? undefined
    : { clientId, refreshToken: presented };
};

const accessReference = async (
  presented: string,
  clientId: string,
): Promise<GrantReference | undefined> => {
  const token = await model.getStoredAccessToken(presented);

  return token?.client.id === clientId ? { clientId, token } : undefined;
};

const selectReference = async (
  presented: string,
  clientId: string,
  hint: string | null,
): Promise<GrantReference | undefined> => {
  if (hint === 'access_token') {
    return (
      (await accessReference(presented, clientId)) ??
      refreshReference(presented, clientId)
    );
  }

  return (
    (await refreshReference(presented, clientId)) ??
    accessReference(presented, clientId)
  );
};

const persistDenial = async (lineage: GrantLineage): Promise<void> => {
  await model.revokeGrant(lineage.familyId, lineage.clientId, {
    aliases: lineage.aliases,
    pair: {
      accessToken: lineage.accessToken,
      refreshToken: lineage.refreshToken,
    },
  });
};

const removeKnownRows = async (
  before: GrantLineage,
  current: GrantLineage,
): Promise<void> => {
  await Promise.all(
    [...new Set([before.accessToken, current.accessToken])].map(
      async (accessToken) => model.deleteToken({ accessToken }),
    ),
  );

  const refreshTokens = [
    ...new Set([before.refreshToken, current.refreshToken]),
  ].filter((token): token is string => token !== undefined);

  await Promise.all(
    refreshTokens.map(async (refreshToken) =>
      model.deleteRefreshToken({
        refreshToken,
        accessToken: current.accessToken,
      }),
    ),
  );
  await Promise.all(
    [...new Set([...before.cacheKeys, ...current.cacheKeys])].map(async (key) =>
      model.deleteRefreshResult(key),
    ),
  );
};

const retryDeniedGrant = async (presented: string, clientId: string) => {
  const aliases = [
    refreshGrantAlias(clientId, presented),
    accessGrantAlias(clientId, presented),
  ];

  const canonicalIds = await Promise.all(
    aliases.map(async (alias) => resolveDeniedGrant(alias, clientId)),
  );

  await Promise.all(
    [...new Set(canonicalIds)].map(async (id) => {
      if (id !== undefined) {
        await retireDeniedGrant(id, clientId);
      }
    }),
  );
};

/** An explicit revoke ends the owned grant and its pending issuer work. */
export const revokeGrantForClient = Effect.fnUntraced(function* (
  presented: string,
  clientId: string,
  hint: string | null,
) {
  const reference = yield* stored('findGrant', async () =>
    selectReference(presented, clientId, hint),
  );

  if (reference === undefined) {
    return yield* stored('retryGrantRetirement', async () =>
      retryDeniedGrant(presented, clientId),
    );
  }

  const trace = stored('traceGrant', async () => traceGrant(reference, model));
  const before = yield* trace;
  yield* stored('denyGrant', async () => persistDenial(before));
  // A refresh may have advanced between identity capture and marker commit.
  const current = yield* trace;

  if (current.familyId !== before.familyId) {
    return yield* OAuthStoreUnavailable.make({
      operation: 'traceGrant',
      cause: 'Grant changed during revocation',
    });
  }

  yield* stored('denyGrant', async () => persistDenial(current));
  yield* stored('deleteGrantRows', async () =>
    removeKnownRows(before, current),
  );
  yield* stored('retireGrant', async () =>
    retireDeniedGrant(before.familyId, clientId),
  );
});
