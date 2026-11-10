/**
 * Unit tests for the send_feedback tool handler.
 *
 * Mocks global fetch, since the handler posts to the Neon feedback service.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { assert } from '../../lib/assert';
import { NEON_FEEDBACK_URL } from '../../lib/config';
import { NEON_HANDLERS } from '../tools/tools';
import { textContent } from './helpers/tool-result';

const MAX_FEEDBACK_LENGTH = 10_000;

const originalFetch = globalThis.fetch;

describe('send_feedback handler', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('posts only the trimmed feedback and the neon_mcp source', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(null, { status: 204 }),
    );

    const result = await NEON_HANDLERS.send_feedback({
      params: { feedback: '  The branch docs were unclear  ' },
    });

    const [request] = vi.mocked(globalThis.fetch).mock.calls[0] ?? [];
    assert(request instanceof Request, 'fetch was not called with a Request');
    expect(request.url).toBe(NEON_FEEDBACK_URL);
    expect(request.method).toBe('POST');
    expect(request.headers.get('content-type')).toBe('application/json');
    expect(request.headers.has('authorization')).toBe(false);
    expect(await request.json()).toEqual({
      feedback: 'The branch docs were unclear',
      source: 'neon_mcp',
    });
    expect(result.content).toHaveLength(1);
    expect(textContent(result)).toBe('Feedback received. Thank you!');
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
