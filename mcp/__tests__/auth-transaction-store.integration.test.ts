import { beforeAll, describe, expect, it } from 'vitest';
import { neon } from '@neondatabase/serverless';
import { createAuthTransactionStore } from '../oauth/auth-transaction-store';
import { seedPendingTransaction } from './auth-transaction-fixtures';
import { DEFAULT_GRANT } from '../utils/grant-context';
import { ensureTestOauthDatabase } from './ensure-test-oauth-database';

describe('auth transaction store', () => {
  beforeAll(async () => {
    await ensureTestOauthDatabase();
  });

  it('approves once across two repository instances', async () => {
    const url = process.env.OAUTH_DATABASE_URL;
    if (!url) {
      throw new Error('OAUTH_DATABASE_URL is required');
    }
    const pending = await seedPendingTransaction();
    const first = createAuthTransactionStore(url);
    const second = createAuthTransactionStore(url);
    const [a, b] = await Promise.all([
      first.approvePending({
        id: pending.transaction.id,
        browserSecret: pending.browserSecret,
        approvedGrant: { projectId: 'proj-a', scopes: ['querying'] },
        approvedScopes: ['read'],
      }),
      second.approvePending({
        id: pending.transaction.id,
        browserSecret: pending.browserSecret,
        approvedGrant: { projectId: 'proj-b', scopes: ['schema'] },
        approvedScopes: ['read', 'write'],
      }),
    ]);
    const winners = [a, b].filter(Boolean);
    expect(winners).toHaveLength(1);
    const loaded = await first.getById(pending.transaction.id);
    expect(loaded?.status).toBe('approved');
    if (loaded?.status !== 'approved') {
      throw new Error('expected approved');
    }
    expect(
      loaded.approvedGrant.projectId === 'proj-a' ||
        loaded.approvedGrant.projectId === 'proj-b',
    ).toBe(true);
  });

  it('returns the existing approval for an identical retry', async () => {
    const url = process.env.OAUTH_DATABASE_URL;
    if (!url) {
      throw new Error('OAUTH_DATABASE_URL is required');
    }
    const pending = await seedPendingTransaction();
    const store = createAuthTransactionStore(url);
    const input = {
      id: pending.transaction.id,
      browserSecret: pending.browserSecret,
      approvedGrant: { projectId: 'proj-a', scopes: ['querying'] },
      approvedScopes: ['read'],
    } satisfies Parameters<typeof store.approvePending>[0];

    const first = await store.approvePending(input);
    const retried = await store.approvePending(input);

    expect(first?.status).toBe('approved');
    expect(retried).toEqual(first);
  });

  it('consumes an approval once across two repository instances', async () => {
    const url = process.env.OAUTH_DATABASE_URL;
    if (!url) {
      throw new Error('OAUTH_DATABASE_URL is required');
    }
    const pending = await seedPendingTransaction();
    const store = createAuthTransactionStore(url);
    const approved = await store.approvePending({
      id: pending.transaction.id,
      browserSecret: pending.browserSecret,
      approvedGrant: DEFAULT_GRANT,
      approvedScopes: ['read'],
    });
    expect(approved?.status).toBe('approved');
    const other = createAuthTransactionStore(url);
    const [first, second] = await Promise.all([
      store.consumeApproved(pending.transaction.id, pending.browserSecret),
      other.consumeApproved(pending.transaction.id, pending.browserSecret),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(await store.getById(pending.transaction.id)).toBeUndefined();
  });

  it('treats an expired row as missing', async () => {
    const url = process.env.OAUTH_DATABASE_URL;
    if (!url) {
      throw new Error('OAUTH_DATABASE_URL is required');
    }
    const created = await seedPendingTransaction();
    const sql = neon(url);
    await sql`
      UPDATE mcpauth.auth_transactions
      SET expires_at = now() - interval '1 minute'
      WHERE id = ${created.transaction.id}
    `;
    const store = createAuthTransactionStore(url);
    expect(
      await store.getPending(created.transaction.id, created.browserSecret),
    ).toBeUndefined();
    expect(await store.getById(created.transaction.id)).toBeUndefined();
    expect(
      await store.approvePending({
        id: created.transaction.id,
        browserSecret: created.browserSecret,
        approvedGrant: DEFAULT_GRANT,
        approvedScopes: ['read'],
      }),
    ).toBeUndefined();
  });
});
