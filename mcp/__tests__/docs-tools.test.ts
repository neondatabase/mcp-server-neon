/**
 * Unit tests for the docs tool handlers.
 *
 * These test the NEON_HANDLERS entries directly by mocking global fetch,
 * since the handlers make external HTTP requests to neon.com.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NeonClientError } from '@neon/sdk';
import { assert } from '../../lib/assert';
import { NEON_DOCS_BASE_URL, NEON_SITE_SEARCH_URL } from '../../lib/config';
import { NEON_HANDLERS } from '../tools/tools';
import type { ToolHandlerExtraParams } from '../tools/types';
import { NotFoundError } from '../server/errors';
import { textContent } from './helpers/tool-result';

const originalFetch = globalThis.fetch;

function fetchedRequest(index = 0): Request {
  const [request] = vi.mocked(globalThis.fetch).mock.calls[index] ?? [];
  assert(request instanceof Request, 'fetch was not called with a Request');
  return request;
}

async function getDoc(slug: string) {
  return textContent(await NEON_HANDLERS.get_doc({ params: { slug } }));
}

describe('get_doc handler', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches a doc page by slug and returns its markdown as text', async () => {
    const mockContent = '# Connection Pooling\nLearn about pooling...';
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(mockContent, { status: 200 }),
    );

    const url = `${NEON_DOCS_BASE_URL}/docs/connect/connection-pooling.md`;
    await expect(getDoc('docs/connect/connection-pooling.md')).resolves.toBe(
      mockContent,
    );
    expect(fetchedRequest().url).toBe(url);
    expect(fetchedRequest().signal).toBeInstanceOf(AbortSignal);
  });

  it('appends .md to slugs that lack it', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('# Prisma Guide', { status: 200 }),
    );

    await expect(getDoc('docs/guides/prisma')).resolves.toBe('# Prisma Guide');
    expect(fetchedRequest().url).toBe(
      `${NEON_DOCS_BASE_URL}/docs/guides/prisma.md`,
    );
  });

  it('throws NotFoundError naming search_docs on a 404 response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('Not Found', { status: 404, statusText: 'Not Found' }),
    );

    const error = await Promise.resolve(
      NEON_HANDLERS.get_doc({ params: { slug: 'docs/nonexistent' } }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error).toHaveProperty(
      'message',
      'Doc page not found: "docs/nonexistent.md". Pass a slug returned by search_docs.',
    );
  });

  it('throws a server error on a 500 response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('Internal Error', {
        status: 500,
        statusText: 'Internal Server Error',
      }),
    );

    const error = await Promise.resolve(
      NEON_HANDLERS.get_doc({ params: { slug: 'docs/broken.md' } }),
    ).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(NeonClientError);
    expect(error).toHaveProperty(
      'message',
      'Failed to fetch doc page "docs/broken.md": 500 Internal Server Error',
    );
  });

  it.each([
    '../../../etc/passwd',
    'https://evil.com/malicious',
    '/etc/passwd',
    '//evil.com/malicious',
  ])('rejects the slug %s as a client error before fetching', async (slug) => {
    await expect(NEON_HANDLERS.get_doc({ params: { slug } })).rejects.toThrow(
      NeonClientError,
    );
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });
});

describe('search_docs handler', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue(Response.json({ hits: [] }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function extra(
    overrides: Partial<ToolHandlerExtraParams>,
  ): ToolHandlerExtraParams {
    return { clientApplication: 'unknown', ...overrides };
  }

  it('posts to the configured site search and tags the caller as MCP', async () => {
    await NEON_HANDLERS.search_docs(
      { params: { query: 'branching' } },
      undefined,
      extra({ userAgent: ' Cursor/1.2 ', clientApplication: 'cursor' }),
    );

    const request = fetchedRequest();
    expect(request.url).toBe(NEON_SITE_SEARCH_URL);
    expect(request.headers.get('x-caller-source')).toBe('mcp');
    expect(request.headers.get('x-caller-user-agent')).toBe('Cursor/1.2');
    expect(request.headers.get('x-caller-client')).toBe('cursor');
  });

  it('drops an unknown client and a user agent a header cannot carry', async () => {
    await NEON_HANDLERS.search_docs(
      { params: { query: 'branching' } },
      undefined,
      extra({ userAgent: '助手/1.0' }),
    );

    const request = fetchedRequest();
    expect(request.headers.get('x-caller-source')).toBe('mcp');
    expect(request.headers.has('x-caller-user-agent')).toBe(false);
    expect(request.headers.has('x-caller-client')).toBe(false);
  });
});

describe('docs config', () => {
  it('NEON_DOCS_BASE_URL points to neon.com', () => {
    expect(NEON_DOCS_BASE_URL).toBe('https://neon.com');
  });
});
