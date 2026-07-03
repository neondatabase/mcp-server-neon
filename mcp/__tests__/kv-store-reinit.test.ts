import { describe, it, expect } from 'vitest';
import { shouldReinitKeyv } from '../oauth/kv-store';

describe('shouldReinitKeyv', () => {
  it.each([
    ['password authentication failed for user "mcp"'],
    ['terminating connection due to administrator command'],
    ['Connection terminated unexpectedly'],
    ['read ECONNRESET'],
    ['connect ECONNREFUSED 10.0.0.1:5432'],
    ['connect ETIMEDOUT'],
    ['getaddrinfo ENOTFOUND ep-xyz.neon.tech'],
  ])('returns true for %s', (msg) => {
    expect(shouldReinitKeyv(new Error(msg))).toBe(true);
  });

  it.each([
    ['relation "mcpauth.tokens" does not exist'],
    ['permission denied for schema mcpauth'],
    ['invalid input syntax for type json'],
    ['duplicate key value violates unique constraint'],
  ])('returns false for %s', (msg) => {
    expect(shouldReinitKeyv(new Error(msg))).toBe(false);
  });

  it('accepts non-Error values', () => {
    expect(shouldReinitKeyv('ECONNRESET')).toBe(true);
    expect(shouldReinitKeyv(null)).toBe(false);
    expect(shouldReinitKeyv(undefined)).toBe(false);
  });
});
