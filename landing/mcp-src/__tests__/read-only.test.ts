import { describe, it, expect } from 'vitest';
import {
  hasWriteScope,
  isReadOnly,
  type ReadOnlyContext,
} from '../utils/read-only';

function ctx(overrides: Partial<ReadOnlyContext> = {}): ReadOnlyContext {
  return { ...overrides };
}

describe('hasWriteScope', () => {
  it('returns true for write and wildcard scopes', () => {
    expect(hasWriteScope('write')).toBe(true);
    expect(hasWriteScope('*')).toBe(true);
    expect(hasWriteScope(['read', 'write'])).toBe(true);
    expect(hasWriteScope(['read', '*'])).toBe(true);
  });

  it('returns false for read-only and empty scopes', () => {
    expect(hasWriteScope('read')).toBe(false);
    expect(hasWriteScope(['read'])).toBe(false);
    expect(hasWriteScope(null)).toBe(false);
    expect(hasWriteScope(undefined)).toBe(false);
    expect(hasWriteScope('')).toBe(false);
    expect(hasWriteScope([])).toBe(false);
  });
});

describe('isReadOnly header precedence', () => {
  it('uses X-Neon-Read-Only when present', () => {
    expect(isReadOnly(ctx({ neonHeaderValue: 'true' }))).toBe(true);
    expect(isReadOnly(ctx({ neonHeaderValue: 'false' }))).toBe(false);
    expect(
      isReadOnly(ctx({ neonHeaderValue: 'false', headerValue: 'true' })),
    ).toBe(false);
  });

  it('falls back to legacy x-read-only', () => {
    expect(isReadOnly(ctx({ headerValue: 'true' }))).toBe(true);
    expect(isReadOnly(ctx({ headerValue: 'false' }))).toBe(false);
  });
});

describe('isReadOnly OAuth scope fallback', () => {
  it('is read-only for read scope only', () => {
    expect(isReadOnly(ctx({ scope: 'read' }))).toBe(true);
    expect(isReadOnly(ctx({ scope: ['read'] }))).toBe(true);
  });

  it('is writable for write or wildcard scopes', () => {
    expect(isReadOnly(ctx({ scope: 'read write' }))).toBe(false);
    expect(isReadOnly(ctx({ scope: ['read', 'write'] }))).toBe(false);
    expect(isReadOnly(ctx({ scope: '*' }))).toBe(false);
  });
});

describe('isReadOnly default behavior', () => {
  it('returns false when no inputs are provided', () => {
    expect(isReadOnly(ctx())).toBe(false);
  });
});
