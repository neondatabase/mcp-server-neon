/**
 * Unit tests for the get_doc handler.
 *
 * These test the NEON_HANDLERS entries directly by mocking global fetch,
 * since the handlers make external HTTP requests to neon.com.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NEON_HANDLERS } from '../tools/tools';
import { NEON_DOCS_BASE_URL } from '../../lib/config';
import { InvalidArgumentError, NotFoundError } from '../server/errors';
import { searchDocsHeaders } from '../tools/handlers/docs';

// Type for the tool result returned by handlers
type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

const originalFetch = globalThis.fetch;

describe('get_doc handler', () => {
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

    const result = (await NEON_HANDLERS.get_doc({
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

    const result = (await NEON_HANDLERS.get_doc({
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

    await NEON_HANDLERS.get_doc({
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
      NEON_HANDLERS.get_doc({
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
      NEON_HANDLERS.get_doc({ params: { slug: 'docs/broken.md' } }),
    ).rejects.toThrow(
      'Failed to fetch doc page "docs/broken.md": 500 Internal Server Error',
    );
  });

  it('throws on network error', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error('DNS failure'));

    await expect(
      NEON_HANDLERS.get_doc({ params: { slug: 'docs/test.md' } }),
    ).rejects.toThrow('DNS failure');
  });

  describe('slug validation', () => {
    it('rejects slugs with path traversal (..) as InvalidArgumentError', async () => {
      await expect(
        NEON_HANDLERS.get_doc({
          params: { slug: '../../../etc/passwd' },
        }),
      ).rejects.toThrow(InvalidArgumentError);

      // fetch should never be called
      expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
    });

    it('rejects slugs with embedded path traversal', async () => {
      await expect(
        NEON_HANDLERS.get_doc({
          params: { slug: 'docs/../../../secret' },
        }),
      ).rejects.toThrow(
        'Invalid doc slug: path traversal ("..") is not allowed',
      );
    });

    it('rejects slugs with absolute URLs (://) as InvalidArgumentError', async () => {
      await expect(
        NEON_HANDLERS.get_doc({
          params: { slug: 'https://evil.com/malicious' },
        }),
      ).rejects.toThrow(InvalidArgumentError);

      expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
    });

    it('rejects slugs starting with / as InvalidArgumentError', async () => {
      await expect(
        NEON_HANDLERS.get_doc({ params: { slug: '/etc/passwd' } }),
      ).rejects.toThrow(InvalidArgumentError);

      expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
    });

    it('rejects protocol-relative URLs (//)', async () => {
      await expect(
        NEON_HANDLERS.get_doc({
          params: { slug: '//evil.com/malicious' },
        }),
      ).rejects.toThrow('Invalid doc slug: slug must not start with "/"');

      expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
    });

    it('accepts valid doc slugs', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response('content', { status: 200 }),
      );

      await NEON_HANDLERS.get_doc({
        params: { slug: 'docs/guides/prisma' },
      });

      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
        `${NEON_DOCS_BASE_URL}/docs/guides/prisma.md`,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });
});

describe('docs config', () => {
  it('NEON_DOCS_BASE_URL points to neon.com', () => {
    expect(NEON_DOCS_BASE_URL).toBe('https://neon.com');
  });
});

describe('searchDocsHeaders', () => {
  it('tags MCP and forwards the user agent and client', () => {
    expect(
      searchDocsHeaders({ userAgent: ' Cursor/1.2 ', client: 'cursor' }),
    ).toEqual({
      'Content-Type': 'application/json',
      'x-caller-source': 'mcp',
      'x-caller-user-agent': 'Cursor/1.2',
      'x-caller-client': 'cursor',
    });
  });

  it('drops values a header cannot carry and an unknown client', () => {
    expect(
      searchDocsHeaders({ userAgent: 'agent\nnext', client: 'unknown' }),
    ).toEqual({ 'Content-Type': 'application/json', 'x-caller-source': 'mcp' });
    expect(searchDocsHeaders({ userAgent: '助手/1.0' })).toEqual({
      'Content-Type': 'application/json',
      'x-caller-source': 'mcp',
    });
    expect(searchDocsHeaders({})).toEqual({
      'Content-Type': 'application/json',
      'x-caller-source': 'mcp',
    });
  });

  it('encodes the client and caps both lengths', () => {
    const headers = searchDocsHeaders({
      userAgent: 'u'.repeat(600),
      client: '助手 ' + 'c'.repeat(200),
    });
    expect(headers['x-caller-user-agent']).toHaveLength(512);
    expect(decodeURIComponent(headers['x-caller-client'] ?? '')).toHaveLength(
      100,
    );
    expect(() => new Headers(headers)).not.toThrow();
  });
});
