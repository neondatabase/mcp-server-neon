import type { RefreshResult } from './kv-store';
import type { RefreshRotation } from './model';
import { model } from './model';
import { logger } from '../utils/logger';

/**
 * How long a rotated refresh token returns the pair its rotation issued even
 * after that pair's refresh token was used: long enough for concurrent
 * refreshes and a client's retry after a lost response.
 */
const REFRESH_REPLAY_GRACE_MS = 5 * 60_000;

const isWithinReplayGrace = (rotatedAt: number): boolean =>
  Date.now() - rotatedAt < REFRESH_REPLAY_GRACE_MS;

/**
 * State of the refresh token a replayed rotation issued: `rotated` when it
 * was itself rotated (another copy of the chain moved on), `live` when it is
 * still unused, `gone` when it was revoked or never persisted.
 */
export type ReplayNext = 'live' | 'rotated' | 'gone';

export type RefreshReplay = { ageMs: number; next: ReplayNext };

/**
 * What a cached rotation answers. Its pair is served within the grace period,
 * and afterwards while the refresh token it issued is unused: the client never
 * received or never stored that pair. Once that token was rotated again or
 * revoked, the replay is rejected, so an old token cannot walk the chain to
 * the live pair.
 */
export type RotationOutcome =
  | { kind: 'serve'; result: RefreshResult }
  | { kind: 'reject'; replay: RefreshReplay };

const nextTokenState = async (refreshToken: string): Promise<ReplayNext> => {
  const rotated = await model.getRefreshResult(refreshToken);

  if (rotated !== undefined) {
    return 'rotated';
  }

  const live = await model.getRefreshToken(refreshToken);

  return live === undefined ? 'gone' : 'live';
};

/**
 * Undefined for a row whose refresh token is the presented one after the grace
 * period: upstream did not rotate it, so the token is still current and is
 * refreshed upstream.
 */
export const resolveRotation = async (
  refreshToken: string,
  clientId: string,
  { result, rotatedAt }: RefreshRotation,
): Promise<RotationOutcome | undefined> => {
  if (isWithinReplayGrace(rotatedAt)) {
    return { kind: 'serve', result };
  }

  if (result.refreshToken === refreshToken) {
    return undefined;
  }

  const replay = {
    ageMs: Date.now() - rotatedAt,
    next: await nextTokenState(result.refreshToken),
  };

  if (replay.next !== 'live') {
    return { kind: 'reject', replay };
  }

  logger.info('Served a late replay of a live rotation', {
    clientId,
    replayAgeMs: replay.ageMs,
  });

  return { kind: 'serve', result };
};

const getOwnedRotation = async (
  refreshToken: string,
  clientId: string,
): Promise<RefreshRotation | undefined> => {
  const rotation = await model.getRefreshRotation(refreshToken);

  if (rotation === undefined) {
    return undefined;
  }

  const owner = await findOwner(refreshToken, rotation.result);

  if (owner === clientId) {
    return rotation;
  }

  logger.warn('Client mismatch for cached refresh result', {
    tokenClientId: owner ?? 'unknown',
    requestClientId: clientId,
  });

  return undefined;
};

/** The outcome of `clientId`'s own cached rotation of `refreshToken`. */
export const resolveOwnedRotation = async (
  refreshToken: string,
  clientId: string,
): Promise<RotationOutcome | undefined> => {
  const rotation = await getOwnedRotation(refreshToken, clientId);

  return rotation === undefined
    ? undefined
    : resolveRotation(refreshToken, clientId, rotation);
};

/** The cached pair `clientId`'s own rotation of `refreshToken` serves. */
export async function getOwnedRefreshResult(
  refreshToken: string,
  clientId: string,
): Promise<RefreshResult | undefined> {
  const outcome = await resolveOwnedRotation(refreshToken, clientId);

  return outcome?.kind === 'serve' ? outcome.result : undefined;
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
