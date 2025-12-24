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
} from './kv-store';

class Model implements AuthorizationCodeModel {
  getClient: (
    clientId: string,
    clientSecret: string,
  ) => Promise<Client | undefined> = async (clientId) => {
    return clients.get(clientId);
  };
  saveClient: (client: Client) => Promise<Client> = async (client) => {
    await clients.set(client.id, client);
    return client;
  };
  saveToken: (token: Token) => Promise<Token> = async (token) => {
    await tokens.set(token.accessToken, token);
    return token;
  };
  deleteToken: (token: Token) => Promise<boolean> = async (token) => {
    return tokens.delete(token.accessToken);
  };
  saveRefreshToken: (token: RefreshToken) => Promise<RefreshToken> = async (
    token,
  ) => {
    await refreshTokens.set(token.refreshToken, token);
    return token;
  };
  deleteRefreshToken: (token: RefreshToken) => Promise<boolean> = async (
    token,
  ) => {
    return refreshTokens.delete(token.refreshToken);
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
    return token;
  };
  getRefreshToken: (refreshToken: string) => Promise<RefreshToken | undefined> =
    async (refreshToken) => {
      return refreshTokens.get(refreshToken);
    };
  saveAuthorizationCode: (
    code: AuthorizationCode,
  ) => Promise<AuthorizationCode> = async (code) => {
    await authorizationCodes.set(code.authorizationCode, code);
    return code;
  };
  getAuthorizationCode: (
    code: string,
  ) => Promise<AuthorizationCode | undefined> = async (code) => {
    return authorizationCodes.get(code);
  };
  revokeAuthorizationCode: (code: AuthorizationCode) => Promise<boolean> =
    async (code) => {
      return authorizationCodes.delete(code.authorizationCode);
    };
}

export const model = new Model();
