import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import Keyv from 'keyv';
import { ensureOauthDatabaseUrl } from '../../e2e/provision-oauth-db';
import { PostgresStore } from '../oauth/kv-store';

let sql: NeonQueryFunction<false, false>;
const tables: string[] = [];

const freshTable = () => {
  const table = `kv_store_test_${randomBytes(6).toString('hex')}`;
  tables.push(table);
  return table;
};

beforeAll(async () => {
  const url = await ensureOauthDatabaseUrl();
  process.env.OAUTH_DATABASE_URL = url;
  sql = neon(url);
});

afterAll(async () => {
  for (const table of tables) {
    await sql.query(`DROP TABLE IF EXISTS mcpauth.${table}`);
  }
});

describe('PostgresStore', () => {
  it('creates one table when many stores start on it at once', async () => {
    const table = freshTable();
    const stores = Array.from({ length: 8 }, () => new PostgresStore(table));
    await Promise.all(stores.map((store) => store.get('k')));
    const [{ columns }] = await sql`
      SELECT json_agg(column_name || ' ' || data_type ORDER BY ordinal_position) AS columns
      FROM information_schema.columns
      WHERE table_schema = 'mcpauth' AND table_name = ${table}`;
    expect(columns).toEqual(['key character varying', 'value text']);
  });

  it('reads rows in the @keyv/postgres layout and writes the same layout', async () => {
    const table = freshTable();
    const keyv = new Keyv<{ n: number }>({ store: new PostgresStore(table) });
    await keyv.get('warm-up');

    await sql.query(
      `INSERT INTO mcpauth.${table} (key, value) VALUES ($1, $2)`,
      ['keyv:legacy', JSON.stringify({ value: { n: 1 }, expires: null })],
    );
    expect(await keyv.get('legacy')).toEqual({ n: 1 });

    expect(await keyv.set('fresh', { n: 2 })).toBe(true);
    const rows = await sql.query(
      `SELECT key, value FROM mcpauth.${table} WHERE key = 'keyv:fresh'`,
    );
    expect(rows).toEqual([
      {
        key: 'keyv:fresh',
        value: JSON.stringify({ value: { n: 2 }, expires: null }),
      },
    ]);
  });

  it('expires entries, deletes by key, and clears only its namespace', async () => {
    const table = freshTable();
    const a = new Keyv<string>({
      store: new PostgresStore(table),
      namespace: 'a',
    });
    const b = new Keyv<string>({
      store: new PostgresStore(table),
      namespace: 'b',
    });

    await a.set('short', 'v', 200);
    await new Promise((r) => setTimeout(r, 300));
    expect(await a.get('short')).toBeUndefined();

    expect(await a.delete('missing')).toBe(false);
    await a.set('k', 'v');
    expect(await a.delete('k')).toBe(true);
    expect(await a.get('k')).toBeUndefined();

    await a.set('k', 'a');
    await b.set('k', 'b');
    await a.clear();
    expect(await a.get('k')).toBeUndefined();
    expect(await b.get('k')).toBe('b');
  });
});
