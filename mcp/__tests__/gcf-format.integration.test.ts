/**
 * End-to-end test for the opt-in GCF response encoding.
 *
 * Exercises NEON_HANDLERS.run_sql directly (the real handler → formatToolResult → content),
 * with the Neon serverless driver and connection-string resolution mocked, and asserts that
 * with NEON_MCP_RESPONSE_FORMAT=gcf the query rows are emitted as a GCF block that decodes
 * back to the rows.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Api } from '../neon-client';

vi.mock('../../lib/config', () => ({ RESPONSE_FORMAT: 'gcf' }));

const rows = Array.from({ length: 20 }, (_, i) => ({
  id: 60 + i,
  name: `Customer ${i}`,
  email: `user${i}@example.com`,
  active: i % 2 === 0,
}));

// The Neon serverless driver: neon(uri) returns a callable query runner.
vi.mock('@neondatabase/serverless', () => ({
  neon: () =>
    Object.assign(() => Promise.resolve(rows), {
      query: () => Promise.resolve(rows),
      transaction: () => Promise.resolve([rows]),
    }),
}));

vi.mock('../tools/handlers/connection-string', () => ({
  handleGetConnectionString: async () => ({ uri: 'postgres://mock/neondb' }),
}));

const { NEON_HANDLERS } = await import('../tools/tools');
const { decodeGeneric } = await import('@blackwell-systems/gcf');

type ToolResult = { content: Array<{ type: string; text: string }> };

const extra = { readOnly: false } as unknown as Parameters<
  typeof NEON_HANDLERS.run_sql
>[2];

describe('run_sql with NEON_MCP_RESPONSE_FORMAT=gcf', () => {
  it('emits a GCF block that decodes back to the query rows', async () => {
    const result = (await NEON_HANDLERS.run_sql(
      { params: { sql: 'select * from customers', projectId: 'proj-1' } },
      {} as Api<unknown>,
      extra,
    )) as ToolResult;

    const text = result.content[0].text;
    expect(text.startsWith('GCF profile=generic')).toBe(true);
    expect(text.split('{id,name,email,active}').length - 1).toBe(1);

    const decoded = decodeGeneric(text) as Array<Map<string, unknown>>;
    expect(decoded.length).toBe(20);
    expect(Object.fromEntries(decoded[0])).toEqual(rows[0]);
  });
});
