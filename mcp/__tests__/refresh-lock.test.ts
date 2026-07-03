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
    // TTL is now short (heartbeat extends it during execute). Sanity-check
    // it's <= 10s so we don't accidentally regress to the old 30s default.
    expect(setSpy.mock.calls[0][2].PX).toBeGreaterThan(0);
    expect(setSpy.mock.calls[0][2].PX).toBeLessThanOrEqual(10_000);
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

  it('on lock not acquired and lock disappears (vanished holder), takes over and runs execute', async () => {
    // Regression for the production "vanished holder" pattern (12 events
    // in 17s at 2026-05-08T07:17 UTC, no accompanying upstream 5xx — most
    // likely a Vercel function killed mid-flight by the platform). Pre-fix:
    // waiter saw lock disappear, threw 503, every concurrent waiter on the
    // same RT also 503'd. Post-fix: the next-up waiter SET NX onto the
    // freed key and becomes the new holder, running execute itself.
    let setCalls = 0;
    setSpy.mockImplementation(async () => {
      setCalls++;
      // First SET fails (peer holds the lock); second SET succeeds (takeover).
      return setCalls === 1 ? null : 'OK';
    });
    getSpy.mockResolvedValue(null); // lock disappeared mid-poll

    const { withRefreshLock } = await loadModule();
    const peek = vi.fn().mockResolvedValue(undefined);
    const execute = vi.fn().mockResolvedValue('took-over');

    const start = Date.now();
    const result = await withRefreshLock('rt', execute, peek);
    const elapsed = Date.now() - start;

    expect(result).toBe('took-over');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(setCalls).toBe(2);
    // Should detect vanish and take over within one poll iteration plus
    // a Redis round-trip — well under the full waiter budget.
    expect(elapsed).toBeLessThan(2_000);
  });

  it('on takeover, only one waiter wins SET NX; the loser falls back to polling the new owner', async () => {
    // Two waiters race to take over after the holder vanishes. SET NX makes
    // it mutually exclusive: only one wins. The loser sees acquired===null
    // and resumes polling against the new owner. Guarantees execute() runs
    // exactly once per token even with concurrent takeover attempts.
    setSpy.mockResolvedValueOnce(null); // initial: peer holds
    setSpy.mockResolvedValueOnce(null); // takeover: lost the race
    let getCount = 0;
    getSpy.mockImplementation(async () => {
      getCount++;
      // First call: lock vanished (triggers takeover attempt). Subsequent:
      // the new holder is in place.
      if (getCount === 1) return null;
      return 'new-peer-owner';
    });

    const { withRefreshLock } = await loadModule();
    let peekCount = 0;
    const peek = vi.fn(async () => {
      peekCount++;
      // After enough polls, the new holder writes the cache.
      return peekCount >= 3 ? 'cached-by-new-holder' : undefined;
    });
    const execute = vi.fn();

    const result = await withRefreshLock('rt', execute, peek);
    expect(result).toBe('cached-by-new-holder');
    expect(execute).not.toHaveBeenCalled();
  });

  it('takeover fires at most once; if the takeover holder also vanishes, surfaces 503', async () => {
    // Caps upstream calls at N+1 (where N = number of vanished holders).
    let setCalls = 0;
    setSpy.mockImplementation(async () => {
      setCalls++;
      return null; // never acquire
    });
    getSpy.mockResolvedValue(null); // every check sees lock gone

    const { withRefreshLock } = await loadModule();
    const peek = vi.fn().mockResolvedValue(undefined);
    const execute = vi.fn();

    await expect(withRefreshLock('rt', execute, peek)).rejects.toMatchObject({
      status: 503,
    });
    // 1 initial acquire + 1 takeover acquire = 2 total SETs (no 3rd).
    expect(setCalls).toBe(2);
    expect(execute).not.toHaveBeenCalled();
  }, 12_000);

  it('holder schedules a heartbeat that extends the lock TTL while execute is running', async () => {
    // Verifies that runWithHeartbeat fires HEARTBEAT_LUA on a schedule, so
    // legitimate slow upstream calls aren't yanked by the short LOCK_TTL_MS.
    vi.useFakeTimers();
    try {
      setSpy.mockResolvedValue('OK');
      evalSpy.mockResolvedValue(1);

      const { withRefreshLock } = await loadModule();

      let resolveExecute: (v: string) => void;
      const execute = vi.fn(
        () =>
          new Promise<string>((res) => {
            resolveExecute = res;
          }),
      );
      const peek = vi.fn().mockResolvedValue(undefined);

      const promise = withRefreshLock('rt', execute, peek);
      // Let acquire + initial peek settle.
      await vi.advanceTimersByTimeAsync(10);
      // Heartbeat fires every ~2.5s. Advance 6s → expect ≥2 heartbeats.
      await vi.advanceTimersByTimeAsync(6_000);
      const heartbeatCalls = evalSpy.mock.calls.filter((c) =>
        String(c[0]).includes('pexpire'),
      );
      expect(heartbeatCalls.length).toBeGreaterThanOrEqual(2);

      resolveExecute!('done');
      await vi.runOnlyPendingTimersAsync();
      vi.useRealTimers();
      await expect(promise).resolves.toBe('done');
    } finally {
      vi.useRealTimers();
    }
  });

  it('on transient hint, releases via the atomic marker+release Lua script', async () => {
    // Production race we're closing: holder hits upstream 5xx, sets the
    // transient marker, then releases the lock. With two separate Redis SETs
    // on Upstash HA, a waiter can see the lock-release on a replica that
    // hasn't replicated the marker yet, fall through to lock_timeout instead
    // of bailing as transient_upstream_5xx. The atomic Lua makes both
    // observable simultaneously.
    setSpy.mockResolvedValue('OK');
    const { withRefreshLock } = await loadModule();
    const execute = vi.fn(async (hint) => {
      hint.markTransientForWaiters = true;
      throw new Error('upstream 5xx');
    });

    await expect(
      withRefreshLock('rt-flaky', execute, async () => undefined),
    ).rejects.toThrow('upstream 5xx');

    expect(evalSpy).toHaveBeenCalledTimes(1);
    const evalArgs = evalSpy.mock.calls[0][1];
    // Lua receives both lockKey and transientKey.
    expect(evalArgs.keys).toEqual([
      'mcp:refresh-lock:rt-flaky',
      'mcp:refresh-transient:rt-flaky',
    ]);
    // arguments: [owner, '1', ttlMs]
    const setOwner = setSpy.mock.calls[0][1];
    expect(evalArgs.arguments[0]).toBe(setOwner);
    expect(evalArgs.arguments[1]).toBe('1');
    expect(evalArgs.arguments[2]).toMatch(/^\d+$/);
    // The Lua script body should include both set+del so the release and
    // marker write happen atomically.
    const script = evalSpy.mock.calls[0][0] as string;
    expect(script).toContain('redis.call("set", KEYS[2]');
    expect(script).toContain('redis.call("del", KEYS[1])');
  });

  it('without transient hint, uses the plain release Lua (no marker keys)', async () => {
    setSpy.mockResolvedValue('OK');
    const { withRefreshLock } = await loadModule();
    const execute = vi.fn().mockResolvedValue('ok');

    await withRefreshLock('rt', execute, async () => undefined);

    expect(evalSpy).toHaveBeenCalledTimes(1);
    const evalArgs = evalSpy.mock.calls[0][1];
    expect(evalArgs.keys).toEqual(['mcp:refresh-lock:rt']);
    expect(evalArgs.arguments).toHaveLength(1); // just owner
  });

  it('hint applies even when execute throws after setting it', async () => {
    setSpy.mockResolvedValue('OK');
    const { withRefreshLock } = await loadModule();
    const execute = vi.fn(async (hint) => {
      hint.markTransientForWaiters = true;
      throw new Error('upstream');
    });

    await expect(
      withRefreshLock('rt', execute, async () => undefined),
    ).rejects.toThrow('upstream');

    // The atomic-with-marker variant should fire even on the throw path.
    const script = evalSpy.mock.calls[0][0] as string;
    expect(script).toContain('KEYS[2]');
  });

  it('on lock disappears with cached result written in the gap, returns cached instead of 503', async () => {
    // Regression for the production race: holder finishes (writes cache,
    // releases lock) between the waiter's peekResult and redis.get within
    // a single poll iteration. The waiter's redis.get sees null, but a
    // peek RIGHT NOW would hit the cache. Pre-fix, the waiter bailed
    // with 503 anyway; post-fix, the final peek before break catches it.
    setSpy.mockResolvedValue(null); // not acquired
    getSpy.mockResolvedValue(null); // lock released

    let peekCount = 0;
    const peek = vi.fn(async () => {
      peekCount++;
      // First peek (during normal poll) sees nothing. The final peek
      // after redis.get returns null sees the just-written cache.
      return peekCount >= 2 ? 'cached-by-peer' : undefined;
    });

    const { withRefreshLock } = await loadModule();
    const result = await withRefreshLock('rt', vi.fn(), peek);

    expect(result).toBe('cached-by-peer');
    expect(peek).toHaveBeenCalledTimes(2);
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
