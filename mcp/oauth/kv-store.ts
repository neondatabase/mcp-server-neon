import { EventEmitter } from 'node:events';
import pg from 'pg';
import { logger } from '../utils/logger';
import { retryAsync } from '../utils/retry';
import type { AuthorizationCode, Client, Token } from 'oauth2-server';
import Keyv from 'keyv';
import { AuthContext } from '../types/auth';
import { AuthDetailsResponse } from '../neon-client';

const SCHEMA = 'mcpauth';

const PG_CONNECT_ERROR_PATTERNS: readonly RegExp[] = [
  /password authentication failed/i,
  /terminating connection/i,
  /connection terminated/i,
  /ECONNRESET/,
  /ECONNREFUSED/,
  /ETIMEDOUT/,
  /ENOTFOUND/,
];

// Postgres `XX000` is Neon's "Couldn't connect to compute node" — emitted
// when a suspended compute fails to scale-from-zero within the connect
// budget. Surfaces on the auth-callback critical path because the
// OAUTH_DATABASE_URL backing project auto-suspends, then the first request
// after the idle window pays an 8–10s wake-up that exceeds the lambda's
// own timeouts. A single retry with a brief delay catches the next request
// against the freshly-woken compute and masks the user-visible failure.
// pg.Pool discards the broken client, so the retry opens a new connection.
export const isPgConnectFailure = (err: unknown): boolean => {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === 'XX000') return true;
  const msg = err instanceof Error ? err.message : String(err);
  return PG_CONNECT_ERROR_PATTERNS.some((re) => re.test(msg));
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

let pool: pg.Pool | null = null;

const getPool = (): pg.Pool => {
  if (!pool) {
    pool = new pg.Pool({ connectionString: process.env.OAUTH_DATABASE_URL });
    // An idle client whose connection the server ends (a compute restart)
    // errors on the pool; without a listener that is an uncaught exception.
    pool.on('error', (err) => {
      logger.error('OAuth database idle connection error:', {
        message: err.message,
        code: 'code' in err ? err.code : undefined,
      });
    });
  }
  return pool;
};

// unique_violation on pg_type's index, or duplicate_object ("type ... already
// exists") when the winner commits between the IF NOT EXISTS check and the
// row type's creation.
const LOST_CREATE_RACE_CODES = new Set(['23505', '42710']);

const lostCreateRace = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  'code' in err &&
  typeof err.code === 'string' &&
  LOST_CREATE_RACE_CODES.has(err.code);

/**
 * Keyv store on one mcpauth table, with the table layout and SQL of
 * @keyv/postgres 2.1.2 so rows written by either read back in the other.
 */
export class PostgresStore extends EventEmitter {
  readonly opts: { table: string };
  namespace?: string;
  private readonly qualifiedTable: string;
  private ready: Promise<void> | null = null;

  constructor(table: string) {
    super();
    this.opts = { table };
    this.qualifiedTable = `${SCHEMA}.${table}`;
  }

  private async createTable(): Promise<void> {
    const ddl = `CREATE SCHEMA IF NOT EXISTS ${SCHEMA}; CREATE TABLE IF NOT EXISTS ${this.qualifiedTable}(key VARCHAR(255) PRIMARY KEY, value TEXT)`;
    try {
      await getPool().query(ddl);
    } catch (err) {
      // Concurrent CREATE ... IF NOT EXISTS can lose the race and roll back
      // before the table exists; by now the winner has committed, so the
      // second run is a no-op.
      if (!lostCreateRace(err)) throw err;
      await getPool().query(ddl);
    }
  }

  private async query<Row extends pg.QueryResultRow>(
    text: string,
    values: unknown[],
  ): Promise<pg.QueryResult<Row>> {
    this.ready ??= this.createTable().catch((err: unknown) => {
      this.ready = null;
      throw err;
    });
    await this.ready;
    return getPool().query<Row>(text, values);
  }

  async get(key: string): Promise<string | undefined> {
    const { rows } = await this.query<{ value: string }>(
      `SELECT value FROM ${this.qualifiedTable} WHERE key = $1`,
      [key],
    );
    return rows[0]?.value;
  }

  async set(key: string, value: string): Promise<void> {
    await this.query(
      `INSERT INTO ${this.qualifiedTable} (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      [key, value],
    );
  }

  async delete(key: string): Promise<boolean> {
    const { rowCount } = await this.query(
      `DELETE FROM ${this.qualifiedTable} WHERE key = $1`,
      [key],
    );
    return (rowCount ?? 0) > 0;
  }

  async clear(): Promise<void> {
    await this.query(`DELETE FROM ${this.qualifiedTable} WHERE key LIKE $1`, [
      this.namespace ? `${this.namespace}:%` : '%',
    ]);
  }
}

const createLazyKeyv = <T>(table: string, errorLabel: string) => {
  let instance: Keyv<T> | null = null;

  const build = (): Keyv<T> => {
    logger.info(`initializing keyv for ${table}`);
    const inst = new Keyv<T>({ store: new PostgresStore(table) });
    inst.on('error', (err) => {
      logger.error(`${errorLabel} keyv error:`, { err });
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
  /** Client that rotated the token. Missing on rows written before it was stored. */
  clientId?: string;
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
  /** Set when the failure rejects only this client, such as a client mismatch. */
  clientId?: string;
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
