import { KeyvPostgres, KeyvPostgresOptions } from '@keyv/postgres';
import { logger } from '../utils/logger';
import { AuthorizationCode, Client, Token } from 'oauth2-server';
import Keyv from 'keyv';
import { AuthContext } from '../types/auth';
import { AuthDetailsResponse } from '@neondatabase/api-client';

const SCHEMA = 'mcpauth';

const createKeyv = <T>(options: KeyvPostgresOptions) =>
  new Keyv<T>({ store: new KeyvPostgres(options) });

export const clients = createKeyv<Client>({
  connectionString: process.env.OAUTH_DATABASE_URL,
  schema: SCHEMA,
  table: 'clients',
});

clients.on('error', (err) => {
  logger.error('Clients keyv error:', { err });
});

export const tokens = createKeyv<Token>({
  connectionString: process.env.OAUTH_DATABASE_URL,
  schema: SCHEMA,
  table: 'tokens',
});

tokens.on('error', (err) => {
  logger.error('Tokens keyv error:', { err });
});

export type RefreshToken = {
  refreshToken: string;
  refreshTokenExpiresAt?: Date | undefined;
  accessToken: string;
};

export const refreshTokens = createKeyv<RefreshToken>({
  connectionString: process.env.OAUTH_DATABASE_URL,
  schema: SCHEMA,
  table: 'refresh_tokens',
});

refreshTokens.on('error', (err) => {
  logger.error('Refresh tokens keyv error:', { err });
});

export const authorizationCodes = createKeyv<AuthorizationCode>({
  connectionString: process.env.OAUTH_DATABASE_URL,
  schema: SCHEMA,
  table: 'authorization_codes',
});

authorizationCodes.on('error', (err) => {
  logger.error('Authorization codes keyv error:', { err });
});

export type ApiKeyRecord = {
  apiKey: string;
  authMethod: AuthDetailsResponse['auth_method'];
  account: AuthContext['extra']['account'];
};

export const apiKeys = createKeyv<ApiKeyRecord>({
  connectionString: process.env.OAUTH_DATABASE_URL,
  schema: SCHEMA,
  table: 'api_keys',
});

apiKeys.on('error', (err) => {
  logger.error('API keys keyv error:', { err });
});
