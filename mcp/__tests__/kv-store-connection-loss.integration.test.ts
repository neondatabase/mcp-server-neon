import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { Client, neon } from '@neondatabase/serverless';
import type { Token } from 'oauth2-server';
import { ensureOauthDatabaseUrl } from '../../e2e/provision-oauth-db';
import {
  getApiKeys,
  getAuthorizationCodes,
  getClientRegisterHeaders,
  getClients,
  getRefreshFailures,
  getRefreshResults,
  getRefreshTokens,
  getTokens,
} from '../oauth/kv-store';

// Tags this file's pool so pg_terminate_backend only hits these connections,
// not other test files sharing the database.
const APPLICATION_NAME = `kv-store-connection-loss-${randomUUID().slice(0, 8)}`;

let url: string;

beforeAll(async () => {
  url = await ensureOauthDatabaseUrl();
  // Through the transaction pooler an idle client holds no backend of its
  // own, so its connection can only be targeted on the direct endpoint.
  const direct = new URL(url);
  direct.hostname = direct.hostname.replace('-pooler.', '.');
  direct.searchParams.set('application_name', APPLICATION_NAME);
  process.env.OAUTH_DATABASE_URL = direct.toString();
});

const waitFor = async (check: () => Promise<boolean>, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 100));
  }
};

const readAllStores = () =>
  Promise.all(
    [
      getClients(),
      getTokens(),
      getRefreshTokens(),
      getAuthorizationCodes(),
      getClientRegisterHeaders(),
      getRefreshResults(),
      getRefreshFailures(),
      getApiKeys(),
    ].map((store) => store.get(`missing-${randomUUID()}`)),
  );

describe('Keyv stores after the server terminates their connections', () => {
  it('recover in every store, from a mid-query and an idle termination', async () => {
    const sql = neon(url);
    const tokenKey = `token-${randomUUID()}`;
    const token: Token = {
      accessToken: tokenKey,
      client: { id: 'client', grants: ['refresh_token'] },
      user: {},
    };

    expect(await getTokens().set(tokenKey, token)).toBe(true);
    expect(await readAllStores()).toEqual(Array(8).fill(undefined));

    // Hold the token row so the next write is mid-query when its backend is
    // terminated, the way a compute restart cuts in-flight queries.
    const locker = new Client(url);
    await locker.connect();
    try {
      await locker.query('BEGIN');
      await locker.query(
        'SELECT 1 FROM mcpauth.tokens WHERE key = $1 FOR UPDATE',
        [`keyv:${tokenKey}`],
      );

      const blockedWrite = getTokens().set(tokenKey, token);
      await waitFor(async () => {
        const rows = await sql`
          SELECT 1 FROM pg_stat_activity
          WHERE application_name = ${APPLICATION_NAME}
            AND wait_event_type = 'Lock'`;
        return rows.length > 0;
      });
      const terminated = await sql`
        SELECT state, pg_terminate_backend(pid) AS ok FROM pg_stat_activity
        WHERE application_name = ${APPLICATION_NAME}`;
      expect(terminated.map((row) => row.state)).toEqual(
        expect.arrayContaining(['active', 'idle']),
      );

      expect(await blockedWrite).toBe(false);
    } finally {
      await locker.query('ROLLBACK');
      await locker.end();
    }

    await waitFor(async () => {
      const rows = await sql`
        SELECT 1 FROM pg_stat_activity
        WHERE application_name = ${APPLICATION_NAME}`;
      return rows.length === 0;
    });

    expect(await readAllStores()).toEqual(Array(8).fill(undefined));
    expect(await getTokens().get(tokenKey)).toEqual(token);
  });
});
