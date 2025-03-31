import {
  AuthorizationCode,
  AuthorizationCodeModel,
  Client,
  Token,
  User,
} from 'oauth2-server';

// In-memory storage for demo purposes
const clients = new Map<string, Client>();
const tokens = new Map<string, Token>();
// const users = new Map<string, User>();
const authorizationCodes = new Map<string, AuthorizationCode>();

export class Model implements AuthorizationCodeModel {
  getClient: (clientId: string, clientSecret: string) => Promise<Client> = (
    clientId,
  ) => {
    const client = clients.get(clientId);
    if (!client) {
      throw new Error('Client not found');
    }

    return Promise.resolve(client);
  };
  saveClient: (client: Client) => Promise<Client> = (client) => {
    clients.set(client.id, client);
    return Promise.resolve(client);
  };
  saveToken: (token: Token) => Promise<Token> = (token) => {
    tokens.set(token.accessToken, token);
    return Promise.resolve(token);
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
  getAccessToken: (accessToken: string) => Promise<Token> = (accessToken) => {
    const token = tokens.get(accessToken);
    if (!token) {
      throw new Error('Access token not found');
    }
    return Promise.resolve(token);
  };
  saveAuthorizationCode: (
    code: AuthorizationCode,
  ) => Promise<AuthorizationCode> = (code) => {
    authorizationCodes.set(code.authorizationCode, code);
    return Promise.resolve(code);
  };
  getAuthorizationCode: (code: string) => Promise<AuthorizationCode> = (
    code,
  ) => {
    const authCode = authorizationCodes.get(code);
    if (!authCode) {
      return Promise.reject(new Error('Authorization code not found'));
    }
    return Promise.resolve(authCode);
  };
  revokeAuthorizationCode: (code: AuthorizationCode) => Promise<boolean> = (
    code,
  ) => {
    authorizationCodes.delete(code.authorizationCode);
    return Promise.resolve(true);
  };
}
