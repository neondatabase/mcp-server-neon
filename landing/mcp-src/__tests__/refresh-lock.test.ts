import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Shared spies the createClient mock closes over.
const setSpy = vi.fn();
const getSpy = vi.fn();
const evalSpy = vi.fn();
const connectSpy = vi.fn();

vi.mock('redis', () => ({
  createClient: vi.fn(() => ({
    on: vi.fn(),
    connect: connectSpy,
    set: setSpy,
    get: getSpy,
    eval: evalSpy,
  })),
}));

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

async function loadModule() {
  // Reset module state so the memoised redis client is rebuilt.
  vi.resetModules();
  return import('../oauth/refresh-lock');
}

beforeEach(() => {
  setSpy.mockReset();
  getSpy.mockReset();
  evalSpy.mockReset();
  connectSpy.mockReset();
  connectSpy.mockResolvedValue(undefined);
  evalSpy.mockResolvedValue(1);
  process.env.KV_URL = 'redis://test';
});

afterEach(() => {
  delete process.env.KV_URL;
  delete process.env.REDIS_URL;
});

describe('withRefreshLock', () => {
  it('falls through to execute when KV_URL is unset', async () => {
    delete process.env.KV_URL;
    delete process.env.REDIS_URL;
    const { withRefreshLock } = await loadModule();
    const execute = vi.fn().mockResolvedValue('result');
    const peek = vi.fn();

    const result = await withRefreshLock('rt', execute, peek);

    expect(result).toBe('result');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(setSpy).not.toHaveBeenCalled();
    expect(peek).not.toHaveBeenCalled();
  });

  it('falls through to execute when redis SET throws', async () => {
    setSpy.mockRejectedValue(new Error('boom'));
    const { withRefreshLock } = await loadModule();
    const execute = vi.fn().mockResolvedValue('result');

    const result = await withRefreshLock('rt', execute, async () => undefined);

    expect(result).toBe('result');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('on lock acquired, peeks cache once before executing', async () => {
    setSpy.mockResolvedValue('OK');
    const { withRefreshLock } = await loadModule();
    const execute = vi.fn().mockResolvedValue('fresh');
    const peek = vi.fn().mockResolvedValue(undefined);

    const result = await withRefreshLock('rt', execute, peek);

    expect(result).toBe('fresh');
    expect(setSpy).toHaveBeenCalledWith(
      expect.stringContaining('mcp:refresh-lock:rt'),
      expect.any(String),
      expect.objectContaining({ NX: true, PX: expect.any(Number) }),
    );
    expect(peek).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    // Release happens via Lua eval.
    expect(evalSpy).toHaveBeenCalledTimes(1);
  });

  it('on lock acquired, returns peeked cache without executing when peer just finished', async () => {
    setSpy.mockResolvedValue('OK');
    const { withRefreshLock } = await loadModule();
    const execute = vi.fn().mockResolvedValue('SHOULD-NOT-RUN');
    const peek = vi.fn().mockResolvedValue('cached');

    const result = await withRefreshLock('rt', execute, peek);

    expect(result).toBe('cached');
    expect(execute).not.toHaveBeenCalled();
    expect(evalSpy).toHaveBeenCalledTimes(1); // still releases
  });

  it('releases the lock with owner-token comparison even when execute throws', async () => {
    setSpy.mockResolvedValue('OK');
    const { withRefreshLock } = await loadModule();
    const execute = vi.fn().mockRejectedValue(new Error('upstream'));

    await expect(
      withRefreshLock('rt', execute, async () => undefined),
    ).rejects.toThrow('upstream');
    expect(evalSpy).toHaveBeenCalledTimes(1);
    // Owner token should match the one passed to SET.
    const setOwner = setSpy.mock.calls[0][1];
    const evalArgs = evalSpy.mock.calls[0][1];
    expect(evalArgs.arguments).toContain(setOwner);
  });

  it('on lock not acquired, polls peek until it returns a result', async () => {
    setSpy.mockResolvedValue(null); // not acquired
    let peekCount = 0;
    const peek = vi.fn(async () => {
      peekCount++;
      return peekCount >= 3 ? 'cached-by-peer' : undefined;
    });
    getSpy.mockResolvedValue('peer-owner'); // lock still held

    const { withRefreshLock } = await loadModule();
    const execute = vi.fn();

    const result = await withRefreshLock('rt', execute, peek);

    expect(result).toBe('cached-by-peer');
    expect(execute).not.toHaveBeenCalled();
    expect(peek).toHaveBeenCalledTimes(3);
  });

  it('on lock not acquired and never resolved, throws 503', async () => {
    setSpy.mockResolvedValue(null);
    getSpy.mockResolvedValue('peer-owner');

    const { withRefreshLock } = await loadModule();
    const peek = vi.fn().mockResolvedValue(undefined);

    await expect(withRefreshLock('rt', vi.fn(), peek)).rejects.toMatchObject({
      status: 503,
      oauth_error: 'temporarily_unavailable',
    });
  }, 10_000);

  it('on lock not acquired and lock disappears, breaks early and throws 503', async () => {
    setSpy.mockResolvedValue(null);
    getSpy.mockResolvedValue(null); // lock released without producing result

    const { withRefreshLock } = await loadModule();
    const peek = vi.fn().mockResolvedValue(undefined);

    const start = Date.now();
    await expect(withRefreshLock('rt', vi.fn(), peek)).rejects.toMatchObject({
      status: 503,
    });
    const elapsed = Date.now() - start;
    // Should bail out fast (one poll iteration), not wait the full ~5s.
    expect(elapsed).toBeLessThan(2_000);
  });
});

describe('signalTransientFailure / peekTransientFailure', () => {
  it('signal writes to redis with 30s TTL', async () => {
    setSpy.mockResolvedValue('OK');
    const { signalTransientFailure } = await loadModule();
    await signalTransientFailure('rt-flaky');

    expect(setSpy).toHaveBeenCalledWith(
      expect.stringContaining('mcp:refresh-transient:rt-flaky'),
      '1',
      expect.objectContaining({ PX: 30_000 }),
    );
  });

  it('signal swallows redis errors so route logic continues', async () => {
    setSpy.mockRejectedValue(new Error('redis exploded'));
    const { signalTransientFailure } = await loadModule();
    await expect(signalTransientFailure('rt-flaky')).resolves.toBeUndefined();
  });

  it('peek returns true when marker is present', async () => {
    getSpy.mockResolvedValue('1');
    const { peekTransientFailure } = await loadModule();
    expect(await peekTransientFailure('rt-flaky')).toBe(true);
  });

  it('peek returns false when marker is absent', async () => {
    getSpy.mockResolvedValue(null);
    const { peekTransientFailure } = await loadModule();
    expect(await peekTransientFailure('rt-flaky')).toBe(false);
  });

  it('peek defaults to false on redis error so caller falls back to normal poll', async () => {
    getSpy.mockRejectedValue(new Error('boom'));
    const { peekTransientFailure } = await loadModule();
    expect(await peekTransientFailure('rt-flaky')).toBe(false);
  });
});
