import type { RefreshResult } from './kv-store';
import { model, type RefreshRotation } from './model';
import { logger } from '../utils/logger';

/**
 * How long a rotated refresh token still returns the pair its rotation
 * issued: long enough for concurrent refreshes and a client's retry after a
 * lost response. Afterwards the token is dead, as RFC 9700 §4.14.2 requires.
 */
const REFRESH_REPLAY_GRACE_MS = 5 * 60_000;

export const isWithinReplayGrace = (rotatedAt: number): boolean =>
  Date.now() - rotatedAt < REFRESH_REPLAY_GRACE_MS;

/**
 * State of the refresh token a replayed rotation issued: `rotated` when it
 * was itself rotated (another copy of the chain moved on), `live` when it is
 * still the current token (the client lost the response), `gone` when it was
 * revoked or never persisted.
 */
export type ReplayNext = 'live' | 'rotated' | 'gone';

export type RefreshReplay = { ageMs: number; next: ReplayNext };

/**
 * The cached rotation of `refreshToken`, if `clientId` owns it and it is
 * within the grace period.
 */
export async function getOwnedRefreshResult(
  refreshToken: string,
  clientId: string,
): Promise<RefreshResult | undefined> {
  const rotation = await getOwnedRotation(refreshToken, clientId);
  return rotation && isWithinReplayGrace(rotation.rotatedAt)
    ? rotation.result
    : undefined;
}

/**
 * `clientId`'s own rotated `refreshToken` presented after the grace period.
 * A row whose refresh token is the presented one records a refresh that
 * upstream did not rotate, so that token is still current.
 */
export async function findRefreshReplay(
  refreshToken: string,
  clientId: string,
): Promise<RefreshReplay | undefined> {
  const rotation = await getOwnedRotation(refreshToken, clientId);
  return rotation && describeReplay(refreshToken, rotation);
}

export async function describeReplay(
  refreshToken: string,
  { result, rotatedAt }: RefreshRotation,
): Promise<RefreshReplay | undefined> {
  if (result.refreshToken === refreshToken || isWithinReplayGrace(rotatedAt)) {
    return undefined;
  }
  return {
    ageMs: Date.now() - rotatedAt,
    next: await nextTokenState(result.refreshToken),
  };
}

async function nextTokenState(refreshToken: string): Promise<ReplayNext> {
  if (await model.getRefreshResult(refreshToken)) return 'rotated';
  if (await model.getRefreshToken(refreshToken)) return 'live';
  return 'gone';
}

async function getOwnedRotation(
  refreshToken: string,
  clientId: string,
): Promise<RefreshRotation | undefined> {
  const rotation = await model.getRefreshRotation(refreshToken);
  if (!rotation) return undefined;
  const owner = await findOwner(refreshToken, rotation.result);
  if (owner === clientId) return rotation;
  logger.warn('Client mismatch for cached refresh result', {
    tokenClientId: owner ?? 'unknown',
    requestClientId: clientId,
  });
  return undefined;
}

/**
 * Rows written before `clientId` was stored are attributed to the client of
 * the access token on either side of the rotation: the one it issued, or the
 * one the rotated refresh token still maps to when persisting the new pair
 * failed. The next rotation deletes both, so the lookup follows the chain of
 * cached rotations until a row names its client or one of those tokens still
 * exists. The owner found is written to every row visited, so each row is
 * walked once. These rows expire with the 7-day result TTL.
 */
async function findOwner(
  refreshToken: string,
  result: RefreshResult,
): Promise<string | undefined> {
  const visited = new Set<string>();
  let key = refreshToken;
  let row: RefreshResult | undefined = result;
  while (row && !visited.has(key)) {
    if (row.clientId !== undefined) {
      await attribute(visited, row.clientId);
      return row.clientId;
    }
    visited.add(key);
    const owner =
      (await clientOf(row.accessToken)) ??
      (await clientOf((await model.getRefreshToken(key))?.accessToken));
    if (owner) {
      await attribute(visited, owner);
      return owner;
    }
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

async function attribute(keys: Set<string>, clientId: string): Promise<void> {
  await Promise.all(
    [...keys].map((key) =>
      model.attributeRefreshResult(key, clientId).catch((err) => {
        logger.warn('Failed to record the owner of a cached refresh result', {
          err,
        });
      }),
    ),
  );
}
