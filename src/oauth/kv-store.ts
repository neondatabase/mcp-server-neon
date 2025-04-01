import { KeyvPostgres, KeyvPostgresOptions } from '@keyv/postgres';
import { logger } from '../utils/logger.js';
import { AuthorizationCode, Client, Token } from 'oauth2-server';
import Keyv from 'keyv';

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
