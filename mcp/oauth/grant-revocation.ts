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

/** An explicit revoke ends this MCP grant, not merely one cache entry. */
export const revokeGrantForClient = async (
  presented: string,
  clientId: string,
  hint: string | null,
): Promise<void> => {
  const reference = await selectReference(presented, clientId, hint);

  if (reference === undefined) {
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

    return;
  }

  const before = await traceGrant(reference, model);
  await persistDenial(before);
  // A refresh may have advanced between identity capture and marker commit.
  const current = await traceGrant(reference, model);

  if (current.familyId !== before.familyId) {
    throw new Error('OAuth grant changed during revocation');
  }

  await persistDenial(current);
  await removeKnownRows(before, current);
  await retireDeniedGrant(before.familyId, clientId);
};
