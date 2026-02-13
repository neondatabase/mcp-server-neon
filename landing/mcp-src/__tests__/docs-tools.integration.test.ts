/**
 * Integration-level contract tests for docs tool handlers.
 *
 * These tests intentionally avoid external network dependencies. They verify the
 * MCP tool interface and expected cross-tool workflow by mocking fetch calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NEON_HANDLERS } from '../tools/tools';
import { NEON_DOCS_BASE_URL, NEON_DOCS_INDEX_URL } from '../resources';
import { InvalidArgumentError, NotFoundError } from '../server/errors';

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

const originalFetch = globalThis.fetch;

describe('docs tools integration contracts (no external network)', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('list_docs_resources returns MCP text content from index URL', async () => {
    const mockIndex = [
      '# Neon Docs',
      '- [AI Concepts](https://neon.com/docs/ai/ai-concepts.md)',
      '- [Connection Pooling](https://neon.com/docs/connect/connection-pooling.md)',
    ].join('\n');
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(mockIndex, { status: 200 }),
    );

    const result = (await NEON_HANDLERS.list_docs_resources()) as ToolResult;

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      NEON_DOCS_INDEX_URL,
    );
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('ai/ai-concepts.md');
  });

  it('supports full workflow: list -> parse slug -> get doc', async () => {
    const mockIndex =
      '- [AI Concepts](https://neon.com/docs/ai/ai-concepts.md)';
    const mockDoc = '# AI Concepts\n\nThis page explains AI docs integration.';
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(new Response(mockIndex, { status: 200 }))
      .mockResolvedValueOnce(new Response(mockDoc, { status: 200 }));

    const indexResult =
      (await NEON_HANDLERS.list_docs_resources()) as ToolResult;
    const slugMatch = indexResult.content[0].text.match(
      /neon\.com\/(docs\/[^\s)]+\.md)/,
    );
    expect(slugMatch).not.toBeNull();
    const slug = slugMatch![1];

    const docResult = (await NEON_HANDLERS.get_doc_resource({
      params: { slug },
    })) as ToolResult;

    expect(vi.mocked(globalThis.fetch)).toHaveBeenNthCalledWith(
      1,
      NEON_DOCS_INDEX_URL,
    );
    expect(vi.mocked(globalThis.fetch)).toHaveBeenNthCalledWith(
      2,
      `${NEON_DOCS_BASE_URL}/docs/ai/ai-concepts.md`,
    );
    expect(docResult.content[0].text).toContain('AI Concepts');
  });

  it('appends .md when slug is provided without extension', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('# Signing up\n\nWelcome.', { status: 200 }),
    );

    await NEON_HANDLERS.get_doc_resource({
      params: { slug: 'docs/get-started/signing-up' },
    });

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      `${NEON_DOCS_BASE_URL}/docs/get-started/signing-up.md`,
    );
  });

  it('maps upstream 404s to NotFoundError', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('Not Found', { status: 404, statusText: 'Not Found' }),
    );

    await expect(
      NEON_HANDLERS.get_doc_resource({
        params: { slug: 'docs/does-not-exist.md' },
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it('rejects invalid slugs before any fetch call', async () => {
    await expect(
      NEON_HANDLERS.get_doc_resource({
        params: { slug: 'https://evil.example/payload' },
      }),
    ).rejects.toThrow(InvalidArgumentError);

    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });
});
