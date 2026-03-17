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
  getAuthorizationCodes,
  getClientRegisterHeaders,
  ClientRegisterHeadersRecord,
  RefreshToken,
  RefreshResult,
} from './kv-store';

class Model implements AuthorizationCodeModel {
  getClient: (
    clientId: string,
    clientSecret: string,
  ) => Promise<Client | undefined> = async (clientId) => {
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

  private static REFRESH_RESULT_TTL_MS = 60_000;

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
}

export const model = new Model();
