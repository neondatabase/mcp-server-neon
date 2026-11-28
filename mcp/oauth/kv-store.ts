import { EventEmitter } from 'node:events';
import pg from 'pg';
import { logger } from '../utils/logger';
import type { AuthorizationCode, Client, Token } from 'oauth2-server';
import Keyv from 'keyv';
import { AuthContext } from '../types/auth';
import { AuthDetailsResponse } from '../neon-client';
import { KvStoreWriteError } from './kv-store-write-error';

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

let pool: pg.Pool | null = null;

export const getOAuthPool = (): pg.Pool => {
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

export const lostCreateRace = (err: unknown): boolean =>
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
      await getOAuthPool().query(ddl);
    } catch (err) {
      // Concurrent CREATE ... IF NOT EXISTS can lose the race and roll back
      // before the table exists; by now the winner has committed, so the
      // second run is a no-op.
      if (!lostCreateRace(err)) throw err;
      await getOAuthPool().query(ddl);
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
    return getOAuthPool().query<Row>(text, values);
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

/**
 * Keyv's `set` and `delete` catch a store error, emit it, and resolve `false`,
 * so a write the database rejected looks like a success. These go around
 * that: `set` throws when Keyv reports the failure, and `delete` asks the
 * store directly, so a missing row (`false`) can't be confused with an error.
 * Rows keep Keyv's key prefix and serialization.
 */
type KvTable<T> = {
  readonly get: Keyv<T>['get'];
  readonly set: (key: string, value: T, ttl?: number) => Promise<void>;
  readonly delete: (key: string) => Promise<boolean>;
};

const strictTable = <T>(
  inst: Keyv<T>,
  store: PostgresStore,
  table: string,
): KvTable<T> => ({
  get: inst.get.bind(inst),
  set: async (key, value, ttl) => {
    let cause: Error | undefined = undefined;

    const capture = (error: Error) => {
      cause = error;
    };

    inst.on('error', capture);

    try {
      if (!(await inst.set(key, value, ttl))) {
        throw new KvStoreWriteError('set', table, { cause });
      }
    } finally {
      inst.off('error', capture);
    }
  },
  delete: async (key) => {
    try {
      return await store.delete(inst._getKeyPrefix(key));
    } catch (error) {
      throw new KvStoreWriteError('delete', table, { cause: error });
    }
  },
});

const createLazyKeyv = <T>(table: string, errorLabel: string) => {
  let instance: KvTable<T> | null = null;

  const build = (): KvTable<T> => {
    logger.info(`initializing keyv for ${table}`);
    const store = new PostgresStore(table);
    const inst = new Keyv<T>({ store });
    inst.on('error', (err) => {
      logger.error(`${errorLabel} keyv error:`, { err });
    });
    logger.info(`keyv initialized for ${table}`);
    return strictTable(inst, store, table);
  };

  return () => (instance ??= build());
};

export const getClients = createLazyKeyv<Client>('clients', 'Clients');
export const getTokens = createLazyKeyv<Token>('tokens', 'Tokens');

export type RefreshToken = {
  clientId?: string;
  grantFamilyId?: string;
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
  grantFamilyId?: string;
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
