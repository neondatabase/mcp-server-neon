import { KeyvPostgres } from '@keyv/postgres';
import { logger } from '../utils/logger';
import { retryAsync } from '../utils/retry';
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

// Postgres `XX000` is Neon's "Couldn't connect to compute node" — emitted
// when a suspended compute fails to scale-from-zero within the connect
// budget. Surfaces on the auth-callback critical path because the
// OAUTH_DATABASE_URL backing project auto-suspends, then the first request
// after the idle window pays an 8–10s wake-up that exceeds the lambda's
// own timeouts. A single retry with a brief delay catches the next request
// against the freshly-woken compute and masks the user-visible failure.
// The lazy Keyv pool re-inits in its error listener concurrently, so the
// retried call grabs a clean pool.
export const isPgConnectFailure = (err: unknown): boolean => {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === 'XX000') return true;
  return shouldReinitKeyv(err);
};

/**
 * Retry a single Postgres-bound call once on connect failures. Idempotent
 * operations only (get/set/delete by primary key). Logs at warn on retry
 * so the SLO dashboards can still see the underlying blip even when the
 * user-visible outcome is success.
 */
export const withPgConnectRetry = <T>(
  op: string,
  fn: () => Promise<T>,
): Promise<T> =>
  retryAsync(fn, {
    attempts: 2,
    delaysMs: [1500],
    op,
    shouldRetry: isPgConnectFailure,
  });

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

/**
 * Cached upstream rejection for a refresh token. Lets us short-circuit retry
 * storms (clients have been observed firing 100–500 retries in sub-second
 * bursts after an `invalid_grant`) without re-pinging upstream Hydra each
 * time.
 */
export type RefreshFailure = {
  failedAt: number;
  oauthError?: string;
  oauthErrorDescription?: string;
};

export const getRefreshFailures = createLazyKeyv<RefreshFailure>(
  'refresh_failures',
  'Refresh failures (cached dead refresh token rejections)',
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
