import type { DenialOptions } from './grant-revocation-store';
import { denyGrant, isGrantRevoked } from './grant-revocation-store';
import {
  grantFamilyId,
  storedGrantFamily,
  GrantRevokedError,
  traceGrant,
} from './grant-family';
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
    const familyId = grantFamilyId(token);
    await this.assertGrantActive(familyId);
    const saved = { ...token, grantFamilyId: familyId };
    await getTokens().set(saved.accessToken, saved);
    await this.assertGrantActive(familyId);

    return saved;
  };
  deleteToken = async (
    token: Token | Pick<Token, 'accessToken'>,
  ): Promise<boolean> => getTokens().delete(token.accessToken);
  saveRefreshToken: (token: RefreshToken) => Promise<RefreshToken> = async (
    token,
  ) => {
    const familyId = storedGrantFamily(token);

    if (familyId !== undefined) {
      await this.assertGrantActive(familyId);
    }
    await getRefreshTokens().set(token.refreshToken, token);

    if (familyId !== undefined) {
      await this.assertGrantActive(familyId);
    }
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
    const token = await this.getStoredAccessToken(accessToken);

    if (token === undefined) {
      return undefined;
    }

    const familyId = storedGrantFamily(token);

    if (familyId === undefined) {
      const lineage = await traceGrant(
        { clientId: token.client.id, token },
        this,
      );

      const revoked = await Promise.all(
        [lineage.familyId, ...lineage.aliases].map(async (id) =>
          this.isGrantRevoked(id),
        ),
      );

      if (revoked.some(Boolean)) {
        return undefined;
      }

      return this.saveToken({ ...token, grantFamilyId: lineage.familyId });
    }

    if (await this.isGrantRevoked(familyId)) {
      return undefined;
    }

    return token;
  };

  getStoredAccessToken = async (
    accessToken: string,
  ): Promise<Token | undefined> => getTokens().get(accessToken);

  isGrantRevoked = isGrantRevoked;

  assertGrantActive = async (familyId: string): Promise<void> => {
    if (await this.isGrantRevoked(familyId)) {
      throw new GrantRevokedError();
    }
  };

  revokeGrant = async (
    id: string,
    clientId: string,
    options: DenialOptions = {},
  ): Promise<void> =>
    denyGrant({
      id,
      clientId,
      canonicalId: options.canonicalId ?? id,
      aliases: options.aliases ?? [],
      pair: options.pair,
    });

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
  // A stale RT is therefore never forwarded upstream: it gets the cached new
  // pair, or `invalid_grant` once that pair's refresh token was rotated again
  // after the grace period (`resolveRotation` in refresh-result.ts).
  //
  // A row is kept for 7 days, so a client that never stored the cached pair
  // can still pick it up that long. Every row is written once with this TTL and
  // `attributeRefreshResult` keeps its expiry, which is what makes
  // `getRefreshRotation` exact.
  private static REFRESH_RESULT_TTL_MS = 7 * 24 * 60 * 60_000;

  saveRefreshResult: (
    oldRefreshToken: string,
    result: RefreshResult,
  ) => Promise<void> = async (oldRefreshToken, result) => {
    const familyId = storedGrantFamily(result);

    if (familyId !== undefined) {
      await this.assertGrantActive(familyId);
    }
    await getRefreshResults().set(
      oldRefreshToken,
      result,
      Model.REFRESH_RESULT_TTL_MS,
    );

    if (familyId !== undefined) {
      await this.assertGrantActive(familyId);
    }
  };

  getRefreshResult: (
    oldRefreshToken: string,
  ) => Promise<RefreshResult | undefined> = async (oldRefreshToken) => {
    return getRefreshResults().get(oldRefreshToken);
  };

  deleteRefreshResult: (oldRefreshToken: string) => Promise<boolean> = async (
    oldRefreshToken,
  ) => getRefreshResults().delete(oldRefreshToken);

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
