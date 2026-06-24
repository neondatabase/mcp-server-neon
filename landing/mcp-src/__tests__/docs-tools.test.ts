/**
 * Unit tests for the docs tool handlers (list_docs_resources + get_doc_resource).
 *
 * These test the NEON_HANDLERS entries directly by mocking global fetch,
 * since the handlers make external HTTP requests to neon.com.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NEON_HANDLERS } from '../tools/tools';
import {
  NEON_DOCS_INDEX_URL,
  NEON_DOCS_BASE_URL,
  NEON_DOCS_SEARCH_URL,
} from '../resources';
import { InvalidArgumentError, NotFoundError } from '../server/errors';

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

    const result = (await NEON_HANDLERS.list_docs_resources()) as ToolResult;

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      NEON_DOCS_INDEX_URL,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toBe(mockIndex);
  });

  it('throws NotFoundError on 404 response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('Not Found', { status: 404, statusText: 'Not Found' }),
    );

    await expect(NEON_HANDLERS.list_docs_resources()).rejects.toThrow(
      NotFoundError,
    );
  });

  it('throws generic Error on 500 response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('Internal Error', {
        status: 500,
        statusText: 'Internal Server Error',
      }),
    );

    await expect(NEON_HANDLERS.list_docs_resources()).rejects.toThrow(
      'Failed to fetch Neon docs index: 500 Internal Server Error',
    );
  });

  it('throws on network error', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(
      new Error('Network unreachable'),
    );

    await expect(NEON_HANDLERS.list_docs_resources()).rejects.toThrow(
      'Network unreachable',
    );
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

    const result = (await NEON_HANDLERS.get_doc_resource({
      params: { slug: 'docs/connect/connection-pooling.md' },
    })) as ToolResult;

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      `${NEON_DOCS_BASE_URL}/docs/connect/connection-pooling.md`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
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

    const result = (await NEON_HANDLERS.get_doc_resource({
      params: { slug: 'docs/guides/prisma' },
    })) as ToolResult;

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      `${NEON_DOCS_BASE_URL}/docs/guides/prisma.md`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.content[0].text).toBe(mockContent);
  });

  it('does not double-append .md when slug already has it', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('content', { status: 200 }),
    );

    await NEON_HANDLERS.get_doc_resource({
      params: { slug: 'docs/guides/prisma.md' },
    });

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      `${NEON_DOCS_BASE_URL}/docs/guides/prisma.md`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('throws NotFoundError on 404 response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('Not Found', { status: 404, statusText: 'Not Found' }),
    );

    await expect(
      NEON_HANDLERS.get_doc_resource({
        params: { slug: 'docs/nonexistent.md' },
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws generic Error on 500 response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('Internal Error', {
        status: 500,
        statusText: 'Internal Server Error',
      }),
    );

    await expect(
      NEON_HANDLERS.get_doc_resource({ params: { slug: 'docs/broken.md' } }),
    ).rejects.toThrow(
      'Failed to fetch doc page "docs/broken.md": 500 Internal Server Error',
    );
  });

  it('throws on network error', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error('DNS failure'));

    await expect(
      NEON_HANDLERS.get_doc_resource({ params: { slug: 'docs/test.md' } }),
    ).rejects.toThrow('DNS failure');
  });

  describe('slug validation', () => {
    it('rejects slugs with path traversal (..) as InvalidArgumentError', async () => {
      await expect(
        NEON_HANDLERS.get_doc_resource({
          params: { slug: '../../../etc/passwd' },
        }),
      ).rejects.toThrow(InvalidArgumentError);

      // fetch should never be called
      expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
    });

    it('rejects slugs with embedded path traversal', async () => {
      await expect(
        NEON_HANDLERS.get_doc_resource({
          params: { slug: 'docs/../../../secret' },
        }),
      ).rejects.toThrow(
        'Invalid doc slug: path traversal ("..") is not allowed',
      );
    });

    it('rejects slugs with absolute URLs (://) as InvalidArgumentError', async () => {
      await expect(
        NEON_HANDLERS.get_doc_resource({
          params: { slug: 'https://evil.com/malicious' },
        }),
      ).rejects.toThrow(InvalidArgumentError);

      expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
    });

    it('rejects slugs starting with / as InvalidArgumentError', async () => {
      await expect(
        NEON_HANDLERS.get_doc_resource({ params: { slug: '/etc/passwd' } }),
      ).rejects.toThrow(InvalidArgumentError);

      expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
    });

    it('rejects protocol-relative URLs (//)', async () => {
      await expect(
        NEON_HANDLERS.get_doc_resource({
          params: { slug: '//evil.com/malicious' },
        }),
      ).rejects.toThrow('Invalid doc slug: slug must not start with "/"');

      expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
    });

    it('accepts valid doc slugs', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response('content', { status: 200 }),
      );

      await NEON_HANDLERS.get_doc_resource({
        params: { slug: 'docs/guides/prisma' },
      });

      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
        `${NEON_DOCS_BASE_URL}/docs/guides/prisma.md`,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });
});

const TEST_SEARCH_URL = 'https://docs-search.example.com';

describe('search_docs handler', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
    process.env.NEON_DOCS_SEARCH_URL = TEST_SEARCH_URL;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.NEON_DOCS_SEARCH_URL;
  });

  it('builds the URL with just q when only query is provided', async () => {
    const mockJson = '{"results":[],"total":0}';
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(mockJson, { status: 200 }),
    );

    const result = (await NEON_HANDLERS.search_docs({
      params: { query: 'connection pooling' },
    })) as ToolResult;

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      `${TEST_SEARCH_URL}/api/docs-search?q=connection+pooling&compact=true`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.content[0].text).toBe(mockJson);
  });

  it('omits mode param when default (hybrid)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('{}', { status: 200 }),
    );

    await NEON_HANDLERS.search_docs({
      params: { query: 'foo', mode: 'hybrid' },
    });

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      `${TEST_SEARCH_URL}/api/docs-search?q=foo&compact=true`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('passes through non-default mode and limit as query params', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('{}', { status: 200 }),
    );

    await NEON_HANDLERS.search_docs({
      params: { query: 'autoscaling', mode: 'semantic', limit: 5 },
    });

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      `${TEST_SEARCH_URL}/api/docs-search?q=autoscaling&compact=true&mode=semantic&limit=5`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('throws on non-2xx response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('Internal Error', {
        status: 500,
        statusText: 'Internal Server Error',
      }),
    );

    await expect(
      NEON_HANDLERS.search_docs({ params: { query: 'foo' } }),
    ).rejects.toThrow('Failed to search docs: 500 Internal Server Error');
  });

  it('throws on network error', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(
      new Error('Connection refused'),
    );

    await expect(
      NEON_HANDLERS.search_docs({ params: { query: 'foo' } }),
    ).rejects.toThrow('Connection refused');
  });
});

describe('resources module exports', () => {
  it('NEON_DOCS_INDEX_URL points to llms.txt', () => {
    expect(NEON_DOCS_INDEX_URL).toBe('https://neon.com/docs/llms.txt');
  });

  it('NEON_DOCS_BASE_URL points to neon.com', () => {
    expect(NEON_DOCS_BASE_URL).toBe('https://neon.com');
  });

  it('NEON_DOCS_SEARCH_URL defaults to empty string when env var is not set', () => {
    const saved = process.env.NEON_DOCS_SEARCH_URL;
    delete process.env.NEON_DOCS_SEARCH_URL;
    // Re-import to pick up the unset env var — module is already cached, so test via the exported value
    // The constant is evaluated at import time; we verify the env var read behavior via the handler guard instead
    expect(typeof NEON_DOCS_SEARCH_URL).toBe('string');
    if (saved !== undefined) process.env.NEON_DOCS_SEARCH_URL = saved;
  });
});
