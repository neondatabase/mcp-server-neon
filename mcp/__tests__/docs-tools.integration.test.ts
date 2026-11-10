/**
 * Integration-level contract tests for docs tool handlers.
 *
 * These tests intentionally avoid external network dependencies. They verify the
 * MCP tool interface and expected cross-tool workflow by mocking fetch calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NeonClientError } from '@neon/sdk';
import * as z from 'zod';
import { assert } from '../../lib/assert';
import { NEON_DOCS_BASE_URL } from '../../lib/config';
import { NEON_HANDLERS } from '../tools/tools';
import { NotFoundError } from '../server/errors';
import { jsonContent, textContent } from './helpers/tool-result';

const originalFetch = globalThis.fetch;

function fetchedUrl(index: number): string {
  const [request] = vi.mocked(globalThis.fetch).mock.calls[index] ?? [];
  assert(request instanceof Request, 'fetch was not called with a Request');
  return request.url;
}

describe('docs tools integration contracts (no external network)', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('supports the full workflow: search_docs -> slug -> get_doc', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        Response.json({
          hits: [
            {
              url: 'https://neon.com/docs/ai/ai-concepts',
              title: 'AI Concepts',
              slug: 'docs/ai/ai-concepts',
              collection: 'docs',
              category: 'docs',
              breadcrumb: ['Docs', 'AI'],
              heading: 'AI Concepts',
              excerpt: 'This page explains AI concepts.',
              score: 1,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        new Response('# AI Concepts\n\nThis page explains AI concepts.', {
          status: 200,
        }),
      );

    const searchResult = await NEON_HANDLERS.search_docs({
      params: { query: 'ai concepts' },
    });
    const { hits } = z
      .object({ hits: z.array(z.object({ slug: z.string() })) })
      .parse(jsonContent(searchResult));

    const docResult = await NEON_HANDLERS.get_doc({
      params: { slug: hits[0].slug },
    });

    expect(fetchedUrl(1)).toBe(`${NEON_DOCS_BASE_URL}/docs/ai/ai-concepts.md`);
    expect(textContent(docResult)).toBe(
      '# AI Concepts\n\nThis page explains AI concepts.',
    );
  });

  it('appends .md when slug is provided without extension', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('# Signing up\n\nWelcome.', { status: 200 }),
    );

    await NEON_HANDLERS.get_doc({
      params: { slug: 'docs/get-started/signing-up' },
    });

    expect(fetchedUrl(0)).toBe(
      `${NEON_DOCS_BASE_URL}/docs/get-started/signing-up.md`,
    );
  });

  it('maps upstream 404s to NotFoundError', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('Not Found', { status: 404, statusText: 'Not Found' }),
    );

    await expect(
      NEON_HANDLERS.get_doc({
        params: { slug: 'docs/does-not-exist.md' },
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it('rejects invalid slugs before any fetch call', async () => {
    await expect(
      NEON_HANDLERS.get_doc({
        params: { slug: 'https://evil.example/payload' },
      }),
    ).rejects.toThrow(NeonClientError);

    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });
});
