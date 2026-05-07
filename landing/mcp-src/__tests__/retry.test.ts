import { describe, it, expect, vi } from 'vitest';

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { retryAsync } from '../utils/retry';

describe('retryAsync', () => {
  it('returns immediately on first-attempt success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await retryAsync(fn, {
      attempts: 3,
      delaysMs: [10, 20],
      op: 'test',
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and returns on later success', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail-1'))
      .mockRejectedValueOnce(new Error('fail-2'))
      .mockResolvedValue('ok');
    const result = await retryAsync(fn, {
      attempts: 3,
      delaysMs: [1, 1],
      op: 'test',
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws the last error after exhausting all attempts', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail-1'))
      .mockRejectedValueOnce(new Error('fail-2'))
      .mockRejectedValue(new Error('fail-3'));
    await expect(
      retryAsync(fn, { attempts: 3, delaysMs: [1, 1], op: 'test' }),
    ).rejects.toThrow('fail-3');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws on misconfigured delaysMs length (attempts - 1 required)', async () => {
    await expect(
      retryAsync(vi.fn(), { attempts: 3, delaysMs: [1, 2, 3], op: 'test' }),
    ).rejects.toThrow(/misconfigured/);
    await expect(
      retryAsync(vi.fn(), { attempts: 3, delaysMs: [1], op: 'test' }),
    ).rejects.toThrow(/misconfigured/);
  });

  it('does not delay after the final attempt fails', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    const start = Date.now();
    await expect(
      retryAsync(fn, { attempts: 2, delaysMs: [50], op: 'test' }),
    ).rejects.toThrow('always fails');
    const elapsed = Date.now() - start;
    // Two attempts with one 50ms delay between them. Total should be
    // ~50ms + small overhead. Crucially, NO trailing delay.
    expect(elapsed).toBeLessThan(150);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
