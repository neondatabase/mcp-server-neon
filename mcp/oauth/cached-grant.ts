import type { RefreshResult } from './kv-store';
import { model } from './model';

export const MAX_REFRESH_CACHE_DEPTH = 64;

/** Establish the owner without rewriting legacy rows or resetting their TTL. */
export async function resolveCachedGrant(
  refreshToken: string,
  cached: RefreshResult,
): Promise<{ clientId: string } | undefined> {
  let key = refreshToken;
  let current: RefreshResult | undefined = cached;
  const seen = new Set<string>();
  for (let depth = 0; current && depth < MAX_REFRESH_CACHE_DEPTH; depth++) {
    if (seen.has(key)) return undefined;
    seen.add(key);
    if (current.clientId !== undefined) {
      return typeof current.clientId === 'string' && current.clientId
        ? { clientId: current.clientId }
        : undefined;
    }
    const token = await model.getAccessToken(current.accessToken);
    if (token) return { clientId: token.client.id };
    key = current.refreshToken;
    current = await model.getRefreshResult(key);
  }
  return undefined;
}
