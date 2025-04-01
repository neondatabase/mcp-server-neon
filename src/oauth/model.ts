import {
  AuthorizationCode,
  AuthorizationCodeModel,
  Client,
  Token,
  User,
} from 'oauth2-server';
import {
  clients,
  tokens,
  refreshTokens,
  authorizationCodes,
  RefreshToken,
} from './kv-store.js';

class Model implements AuthorizationCodeModel {
  getClient: (
    clientId: string,
    clientSecret: string,
  ) => Promise<Client | undefined> = async (clientId) => {
    const client = await clients.get(clientId);
    return Promise.resolve(client);
  };
  saveClient: (client: Client) => Promise<Client> = async (client) => {
    await clients.set(client.id, client);
    return Promise.resolve(client);
  };
  saveToken: (token: Token) => Promise<Token> = async (token) => {
    await tokens.set(token.accessToken, token);
    return Promise.resolve(token);
  };
  deleteToken: (token: Token) => Promise<boolean> = async (token) => {
    await tokens.delete(token.accessToken);
    return Promise.resolve(true);
  };
  saveRefreshToken: (token: RefreshToken) => Promise<RefreshToken> = async (
    token,
  ) => {
    await refreshTokens.set(token.refreshToken, token);
    return Promise.resolve(token);
  };
  deleteRefreshToken: (token: RefreshToken) => Promise<boolean> = async (
    token,
  ) => {
    await refreshTokens.delete(token.refreshToken);
    return Promise.resolve(true);
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
    const token = await tokens.get(accessToken);
    return Promise.resolve(token);
  };
  getRefreshToken: (refreshToken: string) => Promise<RefreshToken | undefined> =
    async (refreshToken) => {
      const token = await refreshTokens.get(refreshToken);
      return Promise.resolve(token);
    };
  saveAuthorizationCode: (
    code: AuthorizationCode,
  ) => Promise<AuthorizationCode> = async (code) => {
    await authorizationCodes.set(code.authorizationCode, code);
    return Promise.resolve(code);
  };
  getAuthorizationCode: (
    code: string,
  ) => Promise<AuthorizationCode | undefined> = async (code) => {
    const authCode = await authorizationCodes.get(code);
    return Promise.resolve(authCode);
  };
  revokeAuthorizationCode: (code: AuthorizationCode) => Promise<boolean> =
    async (code) => {
      await authorizationCodes.delete(code.authorizationCode);
      return Promise.resolve(true);
    };
}

export const model = new Model();
