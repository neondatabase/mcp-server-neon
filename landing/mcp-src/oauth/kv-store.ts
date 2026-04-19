import { KeyvPostgres } from '@keyv/postgres';
import { logger } from '../utils/logger';
import type { AuthorizationCode, Client, Token } from 'oauth2-server';
import Keyv from 'keyv';
import { AuthContext } from '../types/auth';
import { AuthDetailsResponse } from '@neondatabase/api-client';
import type { GrantContext } from '../utils/grant-context';

const SCHEMA = 'mcpauth';

// Errors where the cached pg pool is likely poisoned and a fresh Keyv
// instance (new pool, fresh env read) is worth trying. Pure config errors
// (wrong URL in env) will still fail after reinit - the cooldown below
// prevents hot-looping in that case.
const REINIT_ERROR_PATTERNS: readonly RegExp[] = [
  /password authentication failed/i,
  /terminating connection/i,
  /connection terminated/i,
  /ECONNRESET/,
  /ECONNREFUSED/,
  /ETIMEDOUT/,
  /ENOTFOUND/,
];

const REINIT_COOLDOWN_MS = 60_000;

export const shouldReinitKeyv = (err: unknown): boolean => {
  const msg = err instanceof Error ? err.message : String(err);
  return REINIT_ERROR_PATTERNS.some((re) => re.test(msg));
};

const createLazyKeyv = <T>(table: string, errorLabel: string) => {
  let instance: Keyv<T> | null = null;
  let lastReinitAt = 0;

  const build = (): Keyv<T> => {
    logger.info(`initializing keyv for ${table}`);
    const inst = new Keyv<T>({
      store: new KeyvPostgres({
        connectionString: process.env.OAUTH_DATABASE_URL,
        schema: SCHEMA,
        table,
      }),
    });
    inst.on('error', (err) => {
      logger.error(`${errorLabel} keyv error:`, { err });
      if (instance !== inst) return;
      if (!shouldReinitKeyv(err)) return;
      const now = Date.now();
      if (now - lastReinitAt < REINIT_COOLDOWN_MS) return;
      lastReinitAt = now;
      instance = null;
      logger.warn(
        `${errorLabel} keyv: dropping cached instance to reinit on next call`,
      );
      inst.disconnect().catch((disconnectErr) => {
        logger.warn(`${errorLabel} keyv: error disconnecting stale instance`, {
          err: disconnectErr,
        });
      });
    });
    logger.info(`keyv initialized for ${table}`);
    return inst;
  };

  return () => (instance ??= build());
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

export type ClientRegisterHeadersRecord = {
  headers: Record<string, string>;
  createdAt: number;
};

export const getClientRegisterHeaders =
  createLazyKeyv<ClientRegisterHeadersRecord>(
    'client_register_headers',
    'Client register headers',
  );

/** Cached outcome of a refresh token exchange for cross-instance deduplication. */
export type RefreshResult = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope?: string | string[];
};

export const getRefreshResults = createLazyKeyv<RefreshResult>(
  'refresh_results',
  'Refresh results (cached refresh token exchange outcome)',
);

export type ApiKeyRecord = {
  apiKey: string;
  authMethod: AuthDetailsResponse['auth_method'];
  account: AuthContext['extra']['account'];
};

export const getApiKeys = createLazyKeyv<ApiKeyRecord>('api_keys', 'API keys');

export type ClientAuthContextRecord = {
  grant: GrantContext;
  scope: string[];
  readOnly: boolean;
  createdAt: number;
  updatedAt: number;
};

export const getClientAuthContexts = createLazyKeyv<ClientAuthContextRecord>(
  'client_auth_contexts',
  'Client auth contexts',
);
