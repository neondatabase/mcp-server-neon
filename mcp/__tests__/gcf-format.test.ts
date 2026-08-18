import { describe, expect, it, vi } from 'vitest';

function rows(n: number): Array<Record<string, unknown>> {
  // Non-alphabetical column order is deliberate: it must be preserved end to end.
  return Array.from({ length: n }, (_, i) => ({
    id: 60 + i,
    name: `Customer ${i}`,
    email: `user${i}@example.com`,
    active: i % 2 === 0,
  }));
}

describe('formatToolResult with NEON_MCP_RESPONSE_FORMAT=gcf', () => {
  vi.mock('../../lib/config', () => ({ RESPONSE_FORMAT: 'gcf' }));

  it('encodes a uniform row array as a GCF block with a single factored header', async () => {
    const { formatToolResult } = await import('../tools/gcf-format');
    const content = await formatToolResult(rows(20));
    expect(content.type).toBe('text');
    expect(content.text.startsWith('GCF profile=generic')).toBe(true);
    expect(content.text.split('{id,name,email,active}').length - 1).toBe(1);
  });

  it('round-trips losslessly (column order preserved)', async () => {
    const { formatToolResult } = await import('../tools/gcf-format');
    const { decodeGeneric } = await import('@blackwell-systems/gcf');
    const input = rows(15);
    const content = await formatToolResult(input);
    const decoded = decodeGeneric(content.text) as Array<Map<string, unknown>>;
    expect(decoded.length).toBe(15);
    expect([...decoded[0].keys()]).toEqual(['id', 'name', 'email', 'active']);
    expect(Object.fromEntries(decoded[0])).toEqual(input[0]);
  });

  it('falls back to JSON on a tiny result (never-grow)', async () => {
    const { formatToolResult } = await import('../tools/gcf-format');
    const content = await formatToolResult([{ n: 1 }]);
    expect(content.text.startsWith('GCF profile=generic')).toBe(false);
    expect(content.text.startsWith('[')).toBe(true);
  });

  it('passes non-row payloads through as JSON', async () => {
    const { formatToolResult } = await import('../tools/gcf-format');
    const obj = await formatToolResult({ project: { id: 'p1' } });
    expect(obj.text.startsWith('{')).toBe(true);
    const empty = await formatToolResult([]);
    expect(empty.text).toBe('[]');
  });
});

describe('formatToolResult with the default (json) format', () => {
  it('returns pretty JSON for a row array, never GCF', async () => {
    vi.resetModules();
    vi.doMock('../../lib/config', () => ({ RESPONSE_FORMAT: 'json' }));
    const { formatToolResult } = await import('../tools/gcf-format');
    const input = rows(20);
    const content = formatToolResult(input);
    expect(content.text.startsWith('GCF profile=generic')).toBe(false);
    expect(content.text).toBe(JSON.stringify(input, null, 2));
    vi.doUnmock('../../lib/config');
  });
});
