import { revokeUpstreamTokens } from '../../lib/oauth/client';
import type { IssuerTokenPair } from '../../lib/oauth/client';
import { model } from './model';
import {
  completeRetirement,
  pendingRetirements,
} from './grant-revocation-store';
import { GrantStateUnavailableError } from './grant-state-error';

/** Snapshot draining preserves intents concurrently added under other pair keys. */
export const retireDeniedGrant = async (
  id: string,
  clientId: string,
): Promise<void> => {
  const deadline = AbortSignal.timeout(8000);
  const pending = await pendingRetirements(id, clientId);

  const results = await Promise.allSettled(
    Object.entries(pending).map(async ([key, pair]) => {
      await revokeUpstreamTokens(pair, deadline);
      await completeRetirement(id, clientId, key);
    }),
  );

  if (results.some((result) => result.status === 'rejected')) {
    throw new GrantStateUnavailableError({
      cause: new Error('Issuer retirement pending'),
    });
  }
};

/** Persist before network: a later explicit retry can finish compensation. */
export const retireLatePair = async (
  id: string,
  clientId: string,
  pair: IssuerTokenPair,
): Promise<void> => {
  await model.revokeGrant(id, clientId, { pair });
  await retireDeniedGrant(id, clientId);
};
