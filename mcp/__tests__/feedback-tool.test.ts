/**
 * Unit tests for the send_feedback tool handler.
 *
 * Mocks global fetch, since the handler posts to the Neon feedback service.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NEON_HANDLERS } from '../tools/tools';
import { NEON_FEEDBACK_URL } from '../../lib/config';
import { MAX_FEEDBACK_LENGTH } from '../tools/toolsSchema';

type ToolResult = { content: Array<{ type: string; text: string }> };

const originalFetch = globalThis.fetch;

describe('send_feedback handler', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('posts only the trimmed feedback and source', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(null, { status: 204 }),
    );

    const result = (await NEON_HANDLERS.send_feedback({
      params: { feedback: '  The branch docs were unclear  ' },
    })) as ToolResult;

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      NEON_FEEDBACK_URL,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedback: 'The branch docs were unclear',
          source: 'neon_mcp',
        }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(result.content[0].text).toBe('Feedback received. Thank you!');
  });

  it('rejects blank or too-long feedback without calling the service', async () => {
    await expect(
      NEON_HANDLERS.send_feedback({ params: { feedback: '   ' } }),
    ).rejects.toThrow();
    await expect(
      NEON_HANDLERS.send_feedback({
        params: { feedback: 'x'.repeat(MAX_FEEDBACK_LENGTH + 1) },
      }),
    ).rejects.toThrow();
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it('explains a rate limit', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(null, { status: 429 }),
    );

    await expect(
      NEON_HANDLERS.send_feedback({ params: { feedback: 'hello' } }),
    ).rejects.toThrow('Too many feedback requests');
  });

  it('explains a network failure or timeout', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(
      new TypeError('fetch failed'),
    );
    await expect(
      NEON_HANDLERS.send_feedback({ params: { feedback: 'hello' } }),
    ).rejects.toThrow('The Neon feedback service could not be reached.');

    vi.mocked(globalThis.fetch).mockRejectedValueOnce(
      new DOMException('timed out', 'TimeoutError'),
    );
    await expect(
      NEON_HANDLERS.send_feedback({ params: { feedback: 'hello' } }),
    ).rejects.toThrow('The Neon feedback service did not respond in time.');
  });

  it('throws on other error responses', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(null, { status: 503, statusText: 'Service Unavailable' }),
    );

    await expect(
      NEON_HANDLERS.send_feedback({ params: { feedback: 'hello' } }),
    ).rejects.toThrow('Failed to send feedback: 503 Service Unavailable');
  });
});
