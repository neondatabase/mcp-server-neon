import { KeyvPostgres } from '@keyv/postgres';
import { logger } from '../utils/logger';
import { AuthorizationCode, Client, Token } from 'oauth2-server';
import Keyv from 'keyv';
import { AuthContext } from '../types/auth';
import { AuthDetailsResponse } from '@neondatabase/api-client';

const SCHEMA = 'mcpauth';

// Factory for lazy-initialized Keyv stores
const createLazyKeyv = <T>(table: string, errorLabel: string) => {
  let instance: Keyv<T> | null = null;
  return () => {
    if (!instance) {
      logger.info(`DEBUG: Creating Keyv instance for ${table}`, {
        hasConnectionString: !!process.env.OAUTH_DATABASE_URL,
        connectionStringLength: process.env.OAUTH_DATABASE_URL?.length,
        schema: SCHEMA,
        table,
      });
      try {
        instance = new Keyv<T>({
          store: new KeyvPostgres({
            connectionString: process.env.OAUTH_DATABASE_URL,
            schema: SCHEMA,
            table,
          }),
        });
        logger.info(`DEBUG: Keyv instance created for ${table}`);
      } catch (createError) {
        logger.error(`DEBUG: Failed to create Keyv instance for ${table}`, {
          error: createError instanceof Error ? createError.message : String(createError),
        });
        throw createError;
      }
      instance.on('error', (err) => {
        logger.error(`${errorLabel} keyv error:`, { err });
      });
    }
    return instance;
  };
};

export const getClients = createLazyKeyv<Client>('clients', 'Clients');
export const getTokens = createLazyKeyv<Token>('tokens', 'Tokens');

export type RefreshToken = {
  refreshToken: string;
  refreshTokenExpiresAt?: Date | undefined;
  accessToken: string;
};

export const getRefreshTokens = createLazyKeyv<RefreshToken>(
  'refresh_tokens',
  'Refresh tokens',
);

export const getAuthorizationCodes = createLazyKeyv<AuthorizationCode>(
  'authorization_codes',
  'Authorization codes',
);

export type ApiKeyRecord = {
  apiKey: string;
  authMethod: AuthDetailsResponse['auth_method'];
  account: AuthContext['extra']['account'];
};

export const getApiKeys = createLazyKeyv<ApiKeyRecord>('api_keys', 'API keys');
