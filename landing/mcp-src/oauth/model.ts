import {
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
  getAuthorizationCodes,
  RefreshToken,
} from './kv-store';
import { logger } from '../utils/logger';

class Model implements AuthorizationCodeModel {
  getClient: (
    clientId: string,
    clientSecret: string,
  ) => Promise<Client | undefined> = async (clientId) => {
    return getClients().get(clientId);
  };
  saveClient: (client: Client) => Promise<Client> = async (client) => {
    logger.info('DEBUG: model.saveClient called', { clientId: client.id });
    const keyvInstance = getClients();
    logger.info('DEBUG: got keyv instance for clients');
    try {
      logger.info('DEBUG: calling keyv.set');
      const result = await keyvInstance.set(client.id, client);
      logger.info('DEBUG: keyv.set completed', { result });
    } catch (setError) {
      logger.error('DEBUG: keyv.set threw error', {
        error: setError instanceof Error ? setError.message : String(setError),
        stack: setError instanceof Error ? setError.stack : undefined,
      });
      throw setError;
    }
    logger.info('DEBUG: model.saveClient returning client');
    return client;
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
}

export const model = new Model();
