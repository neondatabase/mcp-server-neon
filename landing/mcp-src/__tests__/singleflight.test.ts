import { describe, it, expect, vi } from 'vitest';
import { singleflight } from '../utils/singleflight';

describe('singleflight', () => {
  it('executes the function and returns its result', async () => {
    const result = await singleflight('key-1', async () => 42);
    expect(result).toBe(42);
  });

  it('coalesces concurrent calls with the same key', async () => {
    const fn = vi.fn(
      () =>
        new Promise<string>((resolve) => setTimeout(() => resolve('ok'), 50)),
    );

    const [a, b, c] = await Promise.all([
      singleflight('key-2', fn),
      singleflight('key-2', fn),
      singleflight('key-2', fn),
    ]);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(a).toBe('ok');
    expect(b).toBe('ok');
    expect(c).toBe('ok');
  });

  it('does not coalesce calls with different keys', async () => {
    const fn = vi.fn(async () => 'result');

    await Promise.all([singleflight('key-a', fn), singleflight('key-b', fn)]);

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('propagates errors to all waiters', async () => {
    const fn = vi.fn(async () => {
      throw new Error('boom');
    });

    const results = await Promise.allSettled([
      singleflight('key-err', fn),
      singleflight('key-err', fn),
    ]);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('rejected');
    expect((results[0] as PromiseRejectedResult).reason.message).toBe('boom');
    expect((results[1] as PromiseRejectedResult).reason.message).toBe('boom');
  });

  it('cleans up after completion so the key can be reused', async () => {
    const fn = vi.fn(async () => 'first');
    await singleflight('key-reuse', fn);

    const fn2 = vi.fn(async () => 'second');
    const result = await singleflight('key-reuse', fn2);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
    expect(result).toBe('second');
  });

  it('cleans up after error so the key can be retried', async () => {
    const failing = vi.fn(async () => {
      throw new Error('fail');
    });
    await singleflight('key-retry', failing).catch(() => {});

    const succeeding = vi.fn(async () => 'recovered');
    const result = await singleflight('key-retry', succeeding);

    expect(result).toBe('recovered');
    expect(succeeding).toHaveBeenCalledTimes(1);
  });
});
