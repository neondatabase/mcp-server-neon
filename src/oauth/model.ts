import { createKeyv } from '@keyv/postgres';
import {
  AuthorizationCode,
  AuthorizationCodeModel,
  Client,
  Token,
  User,
} from 'oauth2-server';

const SCHEMA = 'mcpauth';
const clients = createKeyv({
  connectionString: process.env.OAUTH_DATABASE_URL,
  schema: SCHEMA,
  table: 'clients',
});

clients.on('error', (err) => {
  console.error('Clienys keyv error:', err);
});

const tokens = createKeyv({
  connectionString: process.env.OAUTH_DATABASE_URL,
  schema: SCHEMA,
  table: 'tokens',
});

tokens.on('error', (err) => {
  console.error('Tokens keyv error:', err);
});

const authorizationCodes = createKeyv({
  connectionString: process.env.OAUTH_DATABASE_URL,
  schema: SCHEMA,
  table: 'authorization_codes',
});

authorizationCodes.on('error', (err) => {
  console.error('Authorization codes keyv error:', err);
});

export class Model implements AuthorizationCodeModel {
  getClient: (clientId: string, clientSecret: string) => Promise<Client> =
    async (clientId) => {
      const client = await clients.get(clientId);
      if (!client) {
        throw new Error('Client not found');
      }

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
  getAccessToken: (accessToken: string) => Promise<Token> = async (
    accessToken,
  ) => {
    const token = await tokens.get(accessToken);
    if (!token) {
      throw new Error('Access token not found');
    }
    return Promise.resolve(token);
  };
  saveAuthorizationCode: (
    code: AuthorizationCode,
  ) => Promise<AuthorizationCode> = async (code) => {
    await authorizationCodes.set(code.authorizationCode, code);
    return Promise.resolve(code);
  };
  getAuthorizationCode: (code: string) => Promise<AuthorizationCode> = async (
    code,
  ) => {
    const authCode = await authorizationCodes.get(code);
    if (!authCode) {
      return Promise.reject(new Error('Authorization code not found'));
    }
    return Promise.resolve(authCode);
  };
  revokeAuthorizationCode: (code: AuthorizationCode) => Promise<boolean> =
    async (code) => {
      await authorizationCodes.delete(code.authorizationCode);
      return Promise.resolve(true);
    };
}
