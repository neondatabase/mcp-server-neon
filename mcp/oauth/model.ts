import type {
  AuthorizationCode,
  AuthorizationCodeModel,
  Client,
  Token,
  User,
} from 'oauth2-server';
import {
  getClients,
  getTokens,
  getRefreshTokens,
  getRefreshResults,
  getRefreshFailures,
  getAuthorizationCodes,
  getClientRegisterHeaders,
  ClientRegisterHeadersRecord,
  RefreshToken,
  RefreshResult,
  RefreshFailure,
} from './kv-store';
import {
  isClientIdMetadataUrl,
  resolveClientIdMetadataDocument,
} from '../../lib/oauth/client-id-metadata-document';

export type RefreshRotation = { result: RefreshResult; rotatedAt: number };

class Model implements AuthorizationCodeModel {
  getClient: (
    clientId: string,
    clientSecret: string,
  ) => Promise<Client | undefined> = async (clientId) => {
    if (isClientIdMetadataUrl(clientId)) {
      return resolveClientIdMetadataDocument(clientId);
    }
    return getClients().get(clientId);
  };
  saveClient: (client: Client) => Promise<Client> = async (client) => {
    await getClients().set(client.id, client);
    return client;
  };
  saveClientRegisterHeaders: (
    clientId: string,
    headers: Record<string, string>,
  ) => Promise<ClientRegisterHeadersRecord> = async (clientId, headers) => {
    const record: ClientRegisterHeadersRecord = {
      headers,
      createdAt: Date.now(),
    };
    await getClientRegisterHeaders().set(clientId, record);
    return record;
  };
  getClientRegisterHeaders: (
    clientId: string,
  ) => Promise<ClientRegisterHeadersRecord | undefined> = async (clientId) => {
    return getClientRegisterHeaders().get(clientId);
  };
  saveToken: (token: Token) => Promise<Token> = async (token) => {
    await getTokens().set(token.accessToken, token);
    return token;
  };
  deleteToken: (token: Token) => Promise<boolean> = async (token) => {
    return getTokens().delete(token.accessToken);
  };
  saveRefreshToken: (token: RefreshToken) => Promise<RefreshToken> = async (
    token,
  ) => {
    await getRefreshTokens().set(token.refreshToken, token);
    return token;
  };
  deleteRefreshToken: (token: RefreshToken) => Promise<boolean> = async (
    token,
  ) => {
    return getRefreshTokens().delete(token.refreshToken);
  };

  validateScope: (
    user: User,
    client: Client,
    scope: string,
  ) => Promise<string> = (user, client, scope) => {
    // For demo purposes, accept all scopes
    return Promise.resolve(scope);
  };
  verifyScope: (token: Token, scope: string) => Promise<boolean> = () => {
    // For demo purposes, accept all scopes
    return Promise.resolve(true);
  };
  getAccessToken: (accessToken: string) => Promise<Token | undefined> = async (
    accessToken,
  ) => {
    const token = await getTokens().get(accessToken);
    return token;
  };
  getRefreshToken: (refreshToken: string) => Promise<RefreshToken | undefined> =
    async (refreshToken) => {
      return getRefreshTokens().get(refreshToken);
    };
  saveAuthorizationCode: (
    code: AuthorizationCode,
  ) => Promise<AuthorizationCode> = async (code) => {
    await getAuthorizationCodes().set(code.authorizationCode, code);
    return code;
  };
  getAuthorizationCode: (
    code: string,
  ) => Promise<AuthorizationCode | undefined> = async (code) => {
    return getAuthorizationCodes().get(code);
  };
  revokeAuthorizationCode: (code: AuthorizationCode) => Promise<boolean> =
    async (code) => {
      return getAuthorizationCodes().delete(code.authorizationCode);
    };

  // Source-code analysis of Hydra v1.11.x confirmed `token_inactive` upstream
  // errors are triggered by *refresh-token-reuse detection* — once Hydra sees
  // the same RT twice (laptop wake, multiple Cursor windows, network blip
  // mid-rotation) it revokes the entire chain and the user must re-auth.
  // A stale RT is therefore never forwarded upstream: within
  // REFRESH_REPLAY_GRACE_MS of the rotation (refresh-result.ts) it gets the
  // cached new pair, and after that `invalid_grant`.
  //
  // A row is kept for 7 days so a later replay is recognized as one: its
  // owner is attributed and the rejection logged as `replay_after_grace`.
  // Every row is written once with this TTL and
  // `attributeRefreshResult` keeps its expiry, which is what makes
  // `getRefreshRotation` exact.
  private static REFRESH_RESULT_TTL_MS = 7 * 24 * 60 * 60_000;

  saveRefreshResult: (
    oldRefreshToken: string,
    result: RefreshResult,
  ) => Promise<void> = async (oldRefreshToken, result) => {
    await getRefreshResults().set(
      oldRefreshToken,
      result,
      Model.REFRESH_RESULT_TTL_MS,
    );
  };

  getRefreshResult: (
    oldRefreshToken: string,
  ) => Promise<RefreshResult | undefined> = async (oldRefreshToken) => {
    return getRefreshResults().get(oldRefreshToken);
  };

  /** The cached rotation of `oldRefreshToken` and when it was rotated. */
  getRefreshRotation: (
    oldRefreshToken: string,
  ) => Promise<RefreshRotation | undefined> = async (oldRefreshToken) => {
    const raw = await getRefreshResults().get(oldRefreshToken, { raw: true });

    if (raw?.value === undefined) {
      return undefined;
    }

    if (raw.expires === undefined || raw.expires === null) {
      throw new Error('Cached refresh result has no expiry');
    }

    return {
      result: raw.value,
      rotatedAt: raw.expires - Model.REFRESH_RESULT_TTL_MS,
    };
  };

  /** Records the owning client on a cached result without extending its expiry. */
  attributeRefreshResult: (
    oldRefreshToken: string,
    clientId: string,
  ) => Promise<void> = async (oldRefreshToken, clientId) => {
    const raw = await getRefreshResults().get(oldRefreshToken, { raw: true });
    if (!raw?.value || typeof raw.expires !== 'number') return;
    const ttl = raw.expires - Date.now();
    if (ttl <= 0) return;
    await getRefreshResults().set(
      oldRefreshToken,
      { ...raw.value, clientId },
      ttl,
    );
  };

  // 4xx rejections won't recover — upstream has invalidated the token.
  // 10 min is plenty to absorb retry storms without keeping stale entries
  // around if a misbehaving client genuinely re-auths and starts over.
  private static REFRESH_FAILURE_TTL_MS = 10 * 60_000;

  saveRefreshFailure: (
    refreshToken: string,
    detail: RefreshFailure,
  ) => Promise<void> = async (refreshToken, detail) => {
    await getRefreshFailures().set(
      refreshToken,
      detail,
      Model.REFRESH_FAILURE_TTL_MS,
    );
  };

  getRefreshFailure: (
    refreshToken: string,
  ) => Promise<RefreshFailure | undefined> = async (refreshToken) => {
    return getRefreshFailures().get(refreshToken);
  };
}

export const model = new Model();
