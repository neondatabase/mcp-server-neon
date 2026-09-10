import { neon } from '@neondatabase/serverless';
import { withPgConnectRetry } from './kv-store';
import {
  parseAuthTransaction,
  type ApprovedAuthTransaction,
  type AuthTransaction,
  type PendingAuthTransaction,
} from './auth-transaction';
import {
  AUTH_TRANSACTION_TTL_MS,
  createAuthTransactionId,
  createBrowserSecret,
  hashBrowserSecret,
  isAuthTransactionId,
} from './browser-binding';
import type { ConsentCeiling } from './consent-approval';
import type { ConsentMode } from './consent-mode';
import type { DownstreamAuthRequest } from './downstream-auth-request';
import type { GrantContext } from '../utils/grant-context';

type CreatePendingInput = {
  request: DownstreamAuthRequest;
  mode: ConsentMode;
  ceiling: ConsentCeiling;
  defaultReadOnly: boolean;
  resourceGrant: GrantContext;
  resourceReadOnlyHard: boolean;
};

type CreatedPendingTransaction = {
  transaction: PendingAuthTransaction;
  browserSecret: string;
};

function sqlFor(connectionString: string) {
  return neon(connectionString);
}

function oauthDatabaseUrl(): string {
  const url = process.env.OAUTH_DATABASE_URL;
  if (!url) {
    throw new Error('OAUTH_DATABASE_URL is required for OAuth transactions');
  }
  return url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function transactionFromRow(row: unknown): AuthTransaction | undefined {
  if (!isRecord(row)) {
    return undefined;
  }
  return parseAuthTransaction({
    id: row.id,
    browserSecretHash: row.browser_secret_hash,
    expiresAt: row.expires_at,
    status: row.status,
    request: row.request,
    mode: row.consent_mode,
    ceiling: row.ceiling,
    defaultReadOnly: row.default_read_only,
    resourceGrant: row.resource_grant,
    resourceReadOnlyHard: row.resource_read_only_hard,
    approvedGrant: row.approved_grant,
    approvedScopes: row.approved_scopes,
  });
}

let schemaReady = false;

async function ensureSchema(connectionString: string): Promise<void> {
  if (schemaReady) {
    return;
  }
  const sql = sqlFor(connectionString);
  await sql.transaction([
    sql`SELECT pg_advisory_xact_lock(872334901)`,
    sql`CREATE SCHEMA IF NOT EXISTS mcpauth`,
    sql`
      CREATE TABLE IF NOT EXISTS mcpauth.auth_transactions (
        id TEXT PRIMARY KEY,
        browser_secret_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'approved')),
        request JSONB NOT NULL,
        consent_mode TEXT NOT NULL CHECK (consent_mode IN ('confirmation', 'editable')),
        ceiling JSONB NOT NULL,
        default_read_only BOOLEAN NOT NULL,
        resource_grant JSONB NOT NULL,
        resource_read_only_hard BOOLEAN NOT NULL,
        approved_grant JSONB,
        approved_scopes JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `,
    sql`
      CREATE INDEX IF NOT EXISTS auth_transactions_expires_at
      ON mcpauth.auth_transactions (expires_at)
    `,
  ]);
  schemaReady = true;
}

async function cleanupExpired(connectionString: string): Promise<void> {
  const sql = sqlFor(connectionString);
  await sql`
    DELETE FROM mcpauth.auth_transactions
    WHERE expires_at <= now()
  `;
}

export function createAuthTransactionStore(connectionString: string) {
  const query = async <T>(op: string, fn: () => Promise<T>): Promise<T> => {
    await withPgConnectRetry(`${op}.ensureSchema`, () =>
      ensureSchema(connectionString),
    );
    return withPgConnectRetry(op, fn);
  };

  return {
    createPending: async (
      input: CreatePendingInput,
    ): Promise<CreatedPendingTransaction> => {
      return query('authTx.createPending', async () => {
        await cleanupExpired(connectionString);
        const sql = sqlFor(connectionString);
        const id = createAuthTransactionId();
        const browserSecret = createBrowserSecret();
        const browserSecretHash = hashBrowserSecret(browserSecret);
        const expiresAt = new Date(Date.now() + AUTH_TRANSACTION_TTL_MS);
        const rows = await sql`
          INSERT INTO mcpauth.auth_transactions (
            id,
            browser_secret_hash,
            expires_at,
            status,
            request,
            consent_mode,
            ceiling,
            default_read_only,
            resource_grant,
            resource_read_only_hard
          )
          VALUES (
            ${id},
            ${browserSecretHash},
            ${expiresAt.toISOString()},
            'pending',
            ${JSON.stringify(input.request)},
            ${input.mode},
            ${JSON.stringify(input.ceiling)},
            ${input.defaultReadOnly},
            ${JSON.stringify(input.resourceGrant)},
            ${input.resourceReadOnlyHard}
          )
          RETURNING *
        `;
        const transaction = transactionFromRow(rows[0]);
        if (!transaction || transaction.status !== 'pending') {
          throw new Error('Failed to persist authorization transaction');
        }
        return { transaction, browserSecret };
      });
    },

    getPending: async (
      id: string,
      browserSecret: string,
    ): Promise<PendingAuthTransaction | undefined> => {
      if (!isAuthTransactionId(id)) {
        return undefined;
      }
      return query('authTx.getPending', async () => {
        const sql = sqlFor(connectionString);
        const hash = hashBrowserSecret(browserSecret);
        const rows = await sql`
          SELECT * FROM mcpauth.auth_transactions
          WHERE id = ${id}
            AND browser_secret_hash = ${hash}
            AND status = 'pending'
            AND expires_at > now()
        `;
        const transaction = transactionFromRow(rows[0]);
        if (!transaction || transaction.status !== 'pending') {
          return undefined;
        }
        return transaction;
      });
    },

    approvePending: async ({
      id,
      browserSecret,
      approvedGrant,
      approvedScopes,
    }: {
      id: string;
      browserSecret: string;
      approvedGrant: GrantContext;
      approvedScopes: string[];
    }): Promise<ApprovedAuthTransaction | undefined> => {
      if (!isAuthTransactionId(id)) {
        return undefined;
      }
      return query('authTx.approvePending', async () => {
        const sql = sqlFor(connectionString);
        const hash = hashBrowserSecret(browserSecret);
        const rows = await sql`
          UPDATE mcpauth.auth_transactions
          SET
            status = 'approved',
            approved_grant = ${JSON.stringify(approvedGrant)},
            approved_scopes = ${JSON.stringify(approvedScopes)}
          WHERE id = ${id}
            AND browser_secret_hash = ${hash}
            AND status = 'pending'
            AND expires_at > now()
          RETURNING *
        `;
        const transaction = transactionFromRow(rows[0]);
        if (!transaction || transaction.status !== 'approved') {
          return undefined;
        }
        return transaction;
      });
    },

    consumeApproved: async (
      id: string,
      browserSecret: string,
    ): Promise<ApprovedAuthTransaction | undefined> => {
      if (!isAuthTransactionId(id)) {
        return undefined;
      }
      return query('authTx.consumeApproved', async () => {
        const sql = sqlFor(connectionString);
        const hash = hashBrowserSecret(browserSecret);
        const rows = await sql`
          DELETE FROM mcpauth.auth_transactions
          WHERE id = ${id}
            AND browser_secret_hash = ${hash}
            AND status = 'approved'
            AND expires_at > now()
          RETURNING *
        `;
        const transaction = transactionFromRow(rows[0]);
        if (!transaction || transaction.status !== 'approved') {
          return undefined;
        }
        return transaction;
      });
    },

    consumePending: async (
      id: string,
      browserSecret: string,
    ): Promise<PendingAuthTransaction | undefined> => {
      if (!isAuthTransactionId(id)) {
        return undefined;
      }
      return query('authTx.consumePending', async () => {
        const sql = sqlFor(connectionString);
        const hash = hashBrowserSecret(browserSecret);
        const rows = await sql`
          DELETE FROM mcpauth.auth_transactions
          WHERE id = ${id}
            AND browser_secret_hash = ${hash}
            AND status = 'pending'
            AND expires_at > now()
          RETURNING *
        `;
        const transaction = transactionFromRow(rows[0]);
        if (!transaction || transaction.status !== 'pending') {
          return undefined;
        }
        return transaction;
      });
    },

    getById: async (id: string): Promise<AuthTransaction | undefined> => {
      if (!isAuthTransactionId(id)) {
        return undefined;
      }
      return query('authTx.getById', async () => {
        const sql = sqlFor(connectionString);
        const rows = await sql`
          SELECT * FROM mcpauth.auth_transactions
          WHERE id = ${id}
            AND expires_at > now()
        `;
        return transactionFromRow(rows[0]);
      });
    },

    consumeBound: async (
      id: string,
      browserSecret: string,
    ): Promise<AuthTransaction | undefined> => {
      if (!isAuthTransactionId(id)) {
        return undefined;
      }
      return query('authTx.consumeBound', async () => {
        const sql = sqlFor(connectionString);
        const hash = hashBrowserSecret(browserSecret);
        const rows = await sql`
          DELETE FROM mcpauth.auth_transactions
          WHERE id = ${id}
            AND browser_secret_hash = ${hash}
            AND expires_at > now()
          RETURNING *
        `;
        return transactionFromRow(rows[0]);
      });
    },
  };
}

type AuthTransactionStore = ReturnType<typeof createAuthTransactionStore>;

export const authTransactions: AuthTransactionStore = {
  createPending: (input) =>
    createAuthTransactionStore(oauthDatabaseUrl()).createPending(input),
  getPending: (id, secret) =>
    createAuthTransactionStore(oauthDatabaseUrl()).getPending(id, secret),
  approvePending: (input) =>
    createAuthTransactionStore(oauthDatabaseUrl()).approvePending(input),
  consumeApproved: (id, secret) =>
    createAuthTransactionStore(oauthDatabaseUrl()).consumeApproved(id, secret),
  consumePending: (id, secret) =>
    createAuthTransactionStore(oauthDatabaseUrl()).consumePending(id, secret),
  getById: (id) => createAuthTransactionStore(oauthDatabaseUrl()).getById(id),
  consumeBound: (id, secret) =>
    createAuthTransactionStore(oauthDatabaseUrl()).consumeBound(id, secret),
};
