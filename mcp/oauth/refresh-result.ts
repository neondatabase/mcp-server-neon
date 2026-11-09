import type { RefreshResult } from './kv-store';
import { model } from './model';

/**
 * The cached rotation of `refreshToken`, if `clientId` owns it.
 *
 * Rows written before `clientId` was stored are attributed to the client of
 * the access token on either side of the rotation: the one it issued, or the
 * one the rotated refresh token still maps to when persisting the new pair
 * failed. The next rotation deletes both, so the lookup follows the chain of
 * cached rotations until a row names its client or one of those tokens still
 * exists. These rows expire with the 7-day result TTL.
 */
export async function getOwnedRefreshResult(
  refreshToken: string,
  clientId: string,
): Promise<RefreshResult | undefined> {
  const result = await model.getRefreshResult(refreshToken);
  if (!result) return undefined;
  const owner = await findOwner(refreshToken, result);
  return owner === clientId ? result : undefined;
}

async function findOwner(
  refreshToken: string,
  result: RefreshResult,
): Promise<string | undefined> {
  const visited = new Set<string>();
  let key = refreshToken;
  let row: RefreshResult | undefined = result;
  while (row && !visited.has(key)) {
    if (row.clientId !== undefined) return row.clientId;
    visited.add(key);
    const owner =
      (await clientOf(row.accessToken)) ??
      (await clientOf((await model.getRefreshToken(key))?.accessToken));
    if (owner) return owner;
    key = row.refreshToken;
    row = await model.getRefreshResult(key);
  }
  return undefined;
}

async function clientOf(
  accessToken: string | undefined,
): Promise<string | undefined> {
  if (!accessToken) return undefined;
  return (await model.getAccessToken(accessToken))?.client.id;
}
