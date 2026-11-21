import type { RefreshResult } from './kv-store';

export const toSeconds = (ms: number): number => Math.floor(ms / 1000);

export const toMilliseconds = (seconds: number): number => seconds * 1000;

/** The body of a successful refresh_token grant. */
export type RefreshTokenResult = {
  access_token: string;
  expires_in: number;
  token_type: 'bearer';
  refresh_token: string;
  scope?: string | string[];
};

// A cached pair served an hour after its rotation carries an expired access
// token. RFC 6749 `expires_in` is a non-negative count of seconds, and clients
// such as Codex (oauth2-rs) reject the whole response when it is negative, so
// they never store the cached refresh token and retry the old one.
export const cachedToResponse = (input: {
  readonly cached: RefreshResult;
  readonly now: number;
}): RefreshTokenResult => ({
  access_token: input.cached.accessToken,
  expires_in: Math.max(0, toSeconds(input.cached.expiresAt - input.now)),
  token_type: 'bearer' as const,
  refresh_token: input.cached.refreshToken,
  scope: input.cached.scope,
});
