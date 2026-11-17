import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { IssuerTokenPair } from '../../lib/oauth/client';
import { GrantStateUnavailableError } from './grant-state-error';
import type pg from 'pg';
import { getOAuthPool, lostCreateRace, withPgConnectRetry } from './kv-store';

const TABLE = 'mcpauth.grant_revocations';

const pendingPairs = z.record(
  z.string().regex(/^[a-f0-9]{64}$/u),
  z.object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1).optional(),
  }),
);

const pairKey = (pair: IssuerTokenPair): string =>
  createHash('sha256')
    .update(JSON.stringify([pair.accessToken, pair.refreshToken]))
    .digest('hex');

type GrantDenial = {
  id: string;
  canonicalId: string;
  clientId: string;
  aliases: string[];
  pair?: IssuerTokenPair;
};

export type DenialOptions = {
  canonicalId?: string;
  aliases?: string[];
  pair?: IssuerTokenPair;
};

class GrantRevocationStore {
  private ready: Promise<void> | null = null;

  private async createTable(): Promise<void> {
    const ddl = `CREATE SCHEMA IF NOT EXISTS mcpauth;
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        id VARCHAR(64) PRIMARY KEY,
        canonical_id VARCHAR(64) NOT NULL,
        client_id TEXT NOT NULL,
        revoked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        pending JSONB NOT NULL DEFAULT '{}'::jsonb
      )`;

    try {
      await getOAuthPool().query(ddl);
    } catch (error) {
      if (!lostCreateRace(error)) {
        throw error;
      }

      await getOAuthPool().query(ddl);
    }
  }

  private async prepare(): Promise<void> {
    try {
      await this.createTable();
    } catch (error) {
      this.ready = null;
      throw error;
    }
  }

  private async query<Row extends pg.QueryResultRow>(
    text: string,
    values: string[],
  ): Promise<pg.QueryResult<Row>> {
    try {
      this.ready ??= this.prepare();
      await this.ready;

      return await withPgConnectRetry('OAuth grant revocation', async () =>
        getOAuthPool().query<Row>(text, values),
      );
    } catch (error) {
      throw new GrantStateUnavailableError({ cause: error });
    }
  }

  async isRevoked(id: string): Promise<boolean> {
    const { rows } = await this.query(`SELECT id FROM ${TABLE} WHERE id = $1`, [
      id,
    ]);

    return rows.length > 0;
  }

  /** One statement commits all denial keys and the captured pair together. */
  async deny(denial: GrantDenial): Promise<void> {
    const { id, canonicalId, clientId, aliases, pair } = denial;
    const ids = [...new Set([id, ...aliases])];
    const intents = pair === undefined ? {} : { [pairKey(pair)]: pair };

    const { rows } = await this.query<{ id: string }>(
      `INSERT INTO ${TABLE}(id, canonical_id, client_id, pending)
       SELECT key, $2::text, $3::text, CASE WHEN key = $2::text THEN $4::jsonb ELSE '{}'::jsonb END
       FROM jsonb_array_elements_text($1::jsonb) AS key
       ON CONFLICT (id) DO UPDATE SET pending = ${TABLE}.pending || excluded.pending
       WHERE ${TABLE}.canonical_id = excluded.canonical_id AND ${TABLE}.client_id = excluded.client_id
       RETURNING id`,
      [JSON.stringify(ids), canonicalId, clientId, JSON.stringify(intents)],
    );

    if (rows.length !== ids.length) {
      throw new Error('OAuth grant denial identity conflict');
    }
  }

  async canonical(
    alias: string,
    clientId: string,
  ): Promise<string | undefined> {
    const { rows } = await this.query<{ canonical_id: string }>(
      `SELECT canonical_id FROM ${TABLE} WHERE id = $1 AND client_id = $2`,
      [alias, clientId],
    );

    return rows[0]?.canonical_id;
  }

  async pending(id: string, clientId: string) {
    const { rows } = await this.query<{ pending: unknown }>(
      `SELECT pending FROM ${TABLE} WHERE id = $1 AND canonical_id = $1 AND client_id = $2`,
      [id, clientId],
    );

    if (rows.length !== 1) {
      throw new Error('OAuth denied grant not found');
    }

    return pendingPairs.parse(rows[0]?.pending);
  }

  async complete(id: string, clientId: string, key: string): Promise<void> {
    await this.query(
      `UPDATE ${TABLE} SET pending = pending - $3 WHERE id = $1 AND client_id = $2`,
      [id, clientId, key],
    );
  }
}

const store = new GrantRevocationStore();

export const isGrantRevoked = async (id: string): Promise<boolean> =>
  store.isRevoked(id);

export const denyGrant = async (denial: GrantDenial): Promise<void> =>
  store.deny(denial);

export const resolveDeniedGrant = async (alias: string, clientId: string) =>
  store.canonical(alias, clientId);

export const pendingRetirements = async (id: string, clientId: string) =>
  store.pending(id, clientId);

export const completeRetirement = async (
  id: string,
  clientId: string,
  key: string,
) => store.complete(id, clientId, key);
