import { GrantStateUnavailableError } from './grant-state-error';
import { createHash } from 'node:crypto';
import type { Token } from 'oauth2-server';
import { z } from 'zod';
import type { RefreshResult, RefreshToken } from './kv-store';

const familyMetadata = z.object({
  grantFamilyId: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
});

export class GrantRevokedError extends Error {
  constructor() {
    super('OAuth authorization grant was revoked');
    this.name = 'GrantRevokedError';
  }
}

export const storedGrantFamily = (
  record: Token | RefreshResult | RefreshToken,
) => familyMetadata.parse(record).grantFamilyId;

export const accessGrantAlias = (
  clientId: string,
  accessToken: string,
): string =>
  createHash('sha256')
    .update(JSON.stringify([clientId, accessToken]))
    .digest('hex');

export const refreshGrantAlias = (
  clientId: string,
  refreshToken: string,
): string =>
  createHash('sha256')
    .update(JSON.stringify(['refresh', clientId, refreshToken]))
    .digest('hex');

export const grantFamilyId = (token: Token): string =>
  storedGrantFamily(token) ??
  accessGrantAlias(token.client.id, token.accessToken);

type GrantStore = {
  getStoredAccessToken: (token: string) => Promise<Token | undefined>;
  getRefreshToken: (token: string) => Promise<RefreshToken | undefined>;
  getRefreshResult: (token: string) => Promise<RefreshResult | undefined>;
};

export type GrantReference = {
  clientId: string;
  refreshToken?: string;
  token?: Token;
  expectedRotation?: RefreshResult;
};

export type GrantLineage = {
  familyId: string;
  clientId: string;
  accessToken: string;
  refreshToken?: string;
  cacheKeys: string[];
  aliases: string[];
};

type Trace = {
  clientId: string;
  families: Set<string>;
  aliases: Set<string>;
  lastStored?: Token;
  accessToken?: string;
  refreshToken?: string;
  store: GrantStore;
  cacheKeys: string[];
  visited: Set<string>;
  expectedRotation?: RefreshResult;
};

const noteFamily = (trace: Trace, family: string | undefined): void => {
  if (family !== undefined) {
    trace.families.add(family);
  }

  if (trace.families.size > 1) {
    throw new Error('OAuth grant family conflict');
  }
};

const noteToken = (trace: Trace, token: Token): void => {
  if (token.client.id !== trace.clientId) {
    throw new Error('OAuth grant owner conflict');
  }

  const family = storedGrantFamily(token);
  noteFamily(trace, family);

  trace.aliases.add(accessGrantAlias(trace.clientId, token.accessToken));

  trace.lastStored = token;
};

const noteRotation = (trace: Trace, row: RefreshResult): void => {
  if (row.clientId !== undefined && row.clientId !== trace.clientId) {
    throw new Error('OAuth rotation owner conflict');
  }

  const family = storedGrantFamily(row);
  noteFamily(trace, family);

  trace.aliases.add(accessGrantAlias(trace.clientId, row.accessToken));

  trace.accessToken = row.accessToken;
  trace.refreshToken = row.refreshToken;
};

const noteStoredRefresh = async (
  trace: Trace,
  key: string,
  store: GrantStore,
): Promise<void> => {
  const row = await store.getRefreshToken(key);

  if (row === undefined) {
    return;
  }

  if (row.clientId !== undefined && row.clientId !== trace.clientId) {
    throw new Error('OAuth refresh owner conflict');
  }

  noteFamily(trace, storedGrantFamily(row));
  const token = await store.getStoredAccessToken(row.accessToken);

  if (token !== undefined) {
    noteToken(trace, token);
  }

  trace.accessToken = row.accessToken;
  trace.refreshToken = key;
};

/** Each step depends on its predecessor; await boundaries keep traversal asynchronous. */
const visitRefresh = async (trace: Trace, key: string): Promise<void> => {
  if (trace.visited.has(key)) {
    throw new Error('OAuth rotation cycle');
  }

  trace.visited.add(key);
  trace.aliases.add(refreshGrantAlias(trace.clientId, key));
  await noteStoredRefresh(trace, key, trace.store);

  const rotation = await trace.store.getRefreshResult(key);

  if (
    trace.visited.size === 1 &&
    trace.expectedRotation !== undefined &&
    (rotation === undefined ||
      rotation.accessToken !== trace.expectedRotation.accessToken ||
      rotation.refreshToken !== trace.expectedRotation.refreshToken ||
      storedGrantFamily(rotation) !== storedGrantFamily(trace.expectedRotation))
  ) {
    throw new GrantStateUnavailableError({
      cause: new Error(
        'OAuth captured rotation changed during family resolution',
      ),
    });
  }

  if (rotation === undefined) {
    return;
  }

  trace.cacheKeys.push(key);
  noteRotation(trace, rotation);

  const token = await trace.store.getStoredAccessToken(rotation.accessToken);

  if (token !== undefined) {
    noteToken(trace, token);
  }

  if (rotation.refreshToken !== key) {
    await visitRefresh(trace, rotation.refreshToken);
  }
};

/** Follow the whole reachable chain, including retained intermediate tokens. */
export const traceGrant = async (
  reference: GrantReference,
  store: GrantStore,
): Promise<GrantLineage> => {
  const trace: Trace = {
    clientId: reference.clientId,
    families: new Set(),
    aliases: new Set(),
    accessToken: reference.token?.accessToken,
    refreshToken: reference.refreshToken ?? reference.token?.refreshToken,
    store,
    cacheKeys: [],
    visited: new Set(),
    expectedRotation: reference.expectedRotation,
  };

  if (reference.token !== undefined) {
    noteToken(trace, reference.token);
  }

  if (trace.refreshToken !== undefined) {
    await visitRefresh(trace, trace.refreshToken);
  }

  if (
    trace.accessToken === undefined ||
    (trace.families.size === 0 && trace.lastStored === undefined)
  ) {
    throw new Error('OAuth grant family cannot be resolved');
  }

  const familyId =
    [...trace.families][0] ??
    accessGrantAlias(trace.clientId, trace.accessToken);

  return {
    familyId,
    clientId: trace.clientId,
    accessToken: trace.accessToken,
    refreshToken: trace.refreshToken,
    cacheKeys: trace.cacheKeys,
    aliases: [...trace.aliases],
  };
};
