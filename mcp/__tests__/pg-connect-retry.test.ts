import { describe, expect, it, vi } from 'vitest';
import { isPgConnectFailure, withPgConnectRetry } from '../oauth/kv-store';

// These pin the predicate / retry helper contract that the /callback
// hot-path depends on. Regression for the 2026-05-12 OAUTH_DATABASE_URL
// compute scale-from-zero hiccup where `internal_error` failures were both
// undebuggable (no clientId in SLO) and unmasked (no retry against the
// freshly-woken compute).

describe('isPgConnectFailure', () => {
  it('matches Postgres XX000 by code', () => {
    const err = Object.assign(new Error("Couldn't connect to compute node"), {
      code: 'XX000',
    });
    expect(isPgConnectFailure(err)).toBe(true);
  });

  it.each([
    ['password authentication failed for user "mcp"'],
    ['terminating connection due to administrator command'],
    ['Connection terminated unexpectedly'],
    ['read ECONNRESET'],
    ['connect ECONNREFUSED 10.0.0.1:5432'],
    ['connect ETIMEDOUT'],
    ['getaddrinfo ENOTFOUND ep-xyz.neon.tech'],
  ])('matches %s', (msg) => {
    expect(isPgConnectFailure(new Error(msg))).toBe(true);
  });

  it.each([
    ['relation "mcpauth.tokens" does not exist'],
    ['permission denied for schema mcpauth'],
    ['invalid input syntax for type json'],
    ['duplicate key value violates unique constraint'],
  ])('does NOT match %s', (msg) => {
    expect(isPgConnectFailure(new Error(msg))).toBe(false);
  });

  it('does NOT match unrelated errors', () => {
    expect(isPgConnectFailure(new Error('not a pg error'))).toBe(false);
    expect(
      isPgConnectFailure(
        Object.assign(new Error('check failed'), { code: '23505' }),
      ),
    ).toBe(false);
    expect(isPgConnectFailure(undefined)).toBe(false);
    expect(isPgConnectFailure(null)).toBe(false);
    expect(isPgConnectFailure('string error')).toBe(false);
  });
});

describe('withPgConnectRetry', () => {
  it('returns the value on first success without retrying', async () => {
    const fn = vi.fn(async () => 'ok');
    await expect(withPgConnectRetry('test.op', fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries once on XX000 and succeeds on the second attempt', async () => {
    const xx000 = Object.assign(new Error("Couldn't connect"), {
      code: 'XX000',
    });
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(xx000)
      .mockResolvedValue('ok');
    await expect(withPgConnectRetry('test.op', fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting both attempts on persistent XX000', async () => {
    const xx000 = Object.assign(new Error("Couldn't connect"), {
      code: 'XX000',
    });
    const fn = vi.fn(async () => {
      throw xx000;
    });
    await expect(withPgConnectRetry('test.op', fn)).rejects.toBe(xx000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry non-retryable errors', async () => {
    const err = new Error('logic bug');
    const fn = vi.fn(async () => {
      throw err;
    });
    await expect(withPgConnectRetry('test.op', fn)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
