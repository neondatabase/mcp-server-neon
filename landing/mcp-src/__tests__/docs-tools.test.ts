/**
 * Unit tests for the docs tool handlers (list_docs_resources + get_doc_resource).
 *
 * These test the NEON_HANDLERS entries directly by mocking global fetch,
 * since the handlers make external HTTP requests to neon.com.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NEON_HANDLERS } from '../tools/tools';
import { NEON_DOCS_INDEX_URL, NEON_DOCS_BASE_URL } from '../resources';

// Type for the tool result returned by handlers
type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

const originalFetch = globalThis.fetch;

describe('list_docs_resources handler', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches from NEON_DOCS_INDEX_URL and returns markdown content', async () => {
    const mockIndex = '# Neon Docs\n- [Guide](https://neon.com/docs/guide.md)';
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(mockIndex, { status: 200 }),
    );

    const result = (await NEON_HANDLERS.list_docs_resources(
      // list_docs_resources takes no params
      {} as never,
      {} as never,
      {} as never,
    )) as ToolResult;

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      NEON_DOCS_INDEX_URL,
    );
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toBe(mockIndex);
  });

  it('throws on non-OK response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('Not Found', { status: 404, statusText: 'Not Found' }),
    );

    await expect(
      NEON_HANDLERS.list_docs_resources({} as never, {} as never, {} as never),
    ).rejects.toThrow('Failed to fetch Neon docs index: 404 Not Found');
  });

  it('throws on network error', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(
      new Error('Network unreachable'),
    );

    await expect(
      NEON_HANDLERS.list_docs_resources({} as never, {} as never, {} as never),
    ).rejects.toThrow('Network unreachable');
  });
});

describe('get_doc_resource handler', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches a doc page by slug and returns markdown content', async () => {
    const mockContent = '# Connection Pooling\nLearn about pooling...';
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(mockContent, { status: 200 }),
    );

    const result = (await NEON_HANDLERS.get_doc_resource(
      { params: { slug: 'docs/connect/connection-pooling.md' } } as never,
      {} as never,
      {} as never,
    )) as ToolResult;

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      `${NEON_DOCS_BASE_URL}/docs/connect/connection-pooling.md`,
    );
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toBe(mockContent);
  });

  it('appends .md to slugs that lack it', async () => {
    const mockContent = '# Prisma Guide';
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(mockContent, { status: 200 }),
    );

    const result = (await NEON_HANDLERS.get_doc_resource(
      { params: { slug: 'docs/guides/prisma' } } as never,
      {} as never,
      {} as never,
    )) as ToolResult;

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      `${NEON_DOCS_BASE_URL}/docs/guides/prisma.md`,
    );
    expect(result.content[0].text).toBe(mockContent);
  });

  it('does not double-append .md when slug already has it', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('content', { status: 200 }),
    );

    await NEON_HANDLERS.get_doc_resource(
      { params: { slug: 'docs/guides/prisma.md' } } as never,
      {} as never,
      {} as never,
    );

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      `${NEON_DOCS_BASE_URL}/docs/guides/prisma.md`,
    );
  });

  it('throws on 404 response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('Not Found', { status: 404, statusText: 'Not Found' }),
    );

    await expect(
      NEON_HANDLERS.get_doc_resource(
        { params: { slug: 'docs/nonexistent.md' } } as never,
        {} as never,
        {} as never,
      ),
    ).rejects.toThrow(
      'Failed to fetch doc page "docs/nonexistent.md": 404 Not Found',
    );
  });

  it('throws on 500 response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('Internal Error', {
        status: 500,
        statusText: 'Internal Server Error',
      }),
    );

    await expect(
      NEON_HANDLERS.get_doc_resource(
        { params: { slug: 'docs/broken.md' } } as never,
        {} as never,
        {} as never,
      ),
    ).rejects.toThrow(
      'Failed to fetch doc page "docs/broken.md": 500 Internal Server Error',
    );
  });

  it('throws on network error', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error('DNS failure'));

    await expect(
      NEON_HANDLERS.get_doc_resource(
        { params: { slug: 'docs/test.md' } } as never,
        {} as never,
        {} as never,
      ),
    ).rejects.toThrow('DNS failure');
  });
});

describe('resources module exports', () => {
  it('NEON_DOCS_INDEX_URL points to llms.txt', () => {
    expect(NEON_DOCS_INDEX_URL).toBe('https://neon.com/docs/llms.txt');
  });

  it('NEON_DOCS_BASE_URL points to neon.com', () => {
    expect(NEON_DOCS_BASE_URL).toBe('https://neon.com');
  });
});
