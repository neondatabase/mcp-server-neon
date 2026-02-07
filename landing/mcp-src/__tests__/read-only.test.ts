import { describe, it, expect } from 'vitest';
import {
  isReadOnly,
  hasWriteScope,
  type ReadOnlyContext,
} from '../utils/read-only';
import type { GrantContext } from '../utils/grant-context';

function ctx(overrides: Partial<ReadOnlyContext> = {}): ReadOnlyContext {
  return { ...overrides };
}

// ---------------------------------------------------------------------------
// hasWriteScope
// ---------------------------------------------------------------------------
describe('hasWriteScope', () => {
  it('returns true for "write"', () => {
    expect(hasWriteScope('write')).toBe(true);
  });

  it('returns true for "*"', () => {
    expect(hasWriteScope('*')).toBe(true);
  });

  it('returns true for array containing "write"', () => {
    expect(hasWriteScope(['read', 'write'])).toBe(true);
  });

  it('returns true for array containing "*"', () => {
    expect(hasWriteScope(['read', '*'])).toBe(true);
  });

  it('returns false for "read" only', () => {
    expect(hasWriteScope('read')).toBe(false);
  });

  it('returns false for array with only "read"', () => {
    expect(hasWriteScope(['read'])).toBe(false);
  });

  it('returns false for null', () => {
    expect(hasWriteScope(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(hasWriteScope(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(hasWriteScope('')).toBe(false);
  });

  it('returns false for empty array', () => {
    expect(hasWriteScope([])).toBe(false);
  });

  it('handles space-separated scope string "read write"', () => {
    expect(hasWriteScope('read write')).toBe(true);
  });

  it('handles space-separated scope string "read" only', () => {
    expect(hasWriteScope('read')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isReadOnly – priority 1: X-Neon-Read-Only header (canonical)
// ---------------------------------------------------------------------------
describe('isReadOnly – X-Neon-Read-Only (canonical header)', () => {
  it('returns true when neonHeaderValue is "true"', () => {
    expect(isReadOnly(ctx({ neonHeaderValue: 'true' }))).toBe(true);
  });

  it('returns true when neonHeaderValue is "True" (case-insensitive)', () => {
    expect(isReadOnly(ctx({ neonHeaderValue: 'True' }))).toBe(true);
  });

  it('returns false when neonHeaderValue is "false"', () => {
    expect(isReadOnly(ctx({ neonHeaderValue: 'false' }))).toBe(false);
  });

  it('neonHeaderValue overrides grant preset', () => {
    const grant: GrantContext = {
      projectId: null,
      preset: 'production_use',
      scopes: null,
      protectedBranches: null,
    };
    // Even though production_use -> read-only, X-Neon-Read-Only "false" wins
    expect(isReadOnly(ctx({ neonHeaderValue: 'false', grant }))).toBe(false);
  });

  it('neonHeaderValue overrides OAuth scope', () => {
    // Scope says "read write" (not read-only), but X-Neon-Read-Only says "true"
    expect(
      isReadOnly(ctx({ neonHeaderValue: 'true', scope: 'read write' })),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isReadOnly – priority 2: x-read-only header (legacy synonym)
// ---------------------------------------------------------------------------
describe('isReadOnly – x-read-only (legacy header)', () => {
  it('returns true when headerValue is "true"', () => {
    expect(isReadOnly(ctx({ headerValue: 'true' }))).toBe(true);
  });

  it('returns true when headerValue is "True" (case-insensitive)', () => {
    expect(isReadOnly(ctx({ headerValue: 'True' }))).toBe(true);
  });

  it('returns false when headerValue is "false"', () => {
    expect(isReadOnly(ctx({ headerValue: 'false' }))).toBe(false);
  });

  it('headerValue overrides grant preset', () => {
    const grant: GrantContext = {
      projectId: null,
      preset: 'production_use',
      scopes: null,
      protectedBranches: null,
    };
    // Even though production_use -> read-only, header "false" wins
    expect(isReadOnly(ctx({ headerValue: 'false', grant }))).toBe(false);
  });

  it('headerValue overrides OAuth scope', () => {
    // Scope says "read write" (not read-only), but header says "true"
    expect(
      isReadOnly(ctx({ headerValue: 'true', scope: 'read write' })),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isReadOnly – both headers produce identical behavior when used alone
// ---------------------------------------------------------------------------
describe('isReadOnly – X-Neon-Read-Only and x-read-only behave identically', () => {
  const testCases = [
    { value: 'true', expected: true },
    { value: 'True', expected: true },
    { value: 'TRUE', expected: true },
    { value: 'false', expected: false },
    { value: 'False', expected: false },
    { value: 'FALSE', expected: false },
    { value: 'anything-else', expected: false },
  ];

  for (const { value, expected } of testCases) {
    it(`X-Neon-Read-Only: "${value}" -> ${expected}`, () => {
      expect(isReadOnly(ctx({ neonHeaderValue: value }))).toBe(expected);
    });

    it(`x-read-only: "${value}" -> ${expected}`, () => {
      expect(isReadOnly(ctx({ headerValue: value }))).toBe(expected);
    });
  }
});

// ---------------------------------------------------------------------------
// isReadOnly – X-Neon-Read-Only takes priority over x-read-only
// ---------------------------------------------------------------------------
describe('isReadOnly – X-Neon-Read-Only takes priority over x-read-only', () => {
  it('X-Neon-Read-Only: true wins over x-read-only: false', () => {
    expect(
      isReadOnly(ctx({ neonHeaderValue: 'true', headerValue: 'false' })),
    ).toBe(true);
  });

  it('X-Neon-Read-Only: false wins over x-read-only: true', () => {
    expect(
      isReadOnly(ctx({ neonHeaderValue: 'false', headerValue: 'true' })),
    ).toBe(false);
  });

  it('falls back to x-read-only when X-Neon-Read-Only is absent', () => {
    expect(
      isReadOnly(ctx({ neonHeaderValue: null, headerValue: 'true' })),
    ).toBe(true);
    expect(
      isReadOnly(ctx({ neonHeaderValue: undefined, headerValue: 'false' })),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isReadOnly – X-Neon-Read-Only composes with custom preset + scopes
// ---------------------------------------------------------------------------
describe('isReadOnly – composition with custom preset and scopes', () => {
  it('X-Neon-Read-Only: true + custom preset with scopes -> read-only', () => {
    const grant: GrantContext = {
      projectId: null,
      preset: 'custom',
      scopes: ['schema', 'querying'],
      protectedBranches: null,
    };
    // Custom scopes filter which tools are available; read-only further strips write tools
    expect(isReadOnly(ctx({ neonHeaderValue: 'true', grant }))).toBe(true);
  });

  it('X-Neon-Read-Only: false + custom preset with scopes -> not read-only', () => {
    const grant: GrantContext = {
      projectId: null,
      preset: 'custom',
      scopes: ['schema', 'querying'],
      protectedBranches: null,
    };
    expect(isReadOnly(ctx({ neonHeaderValue: 'false', grant }))).toBe(false);
  });

  it('x-read-only: true + custom preset with scopes -> read-only (legacy)', () => {
    const grant: GrantContext = {
      projectId: null,
      preset: 'custom',
      scopes: ['docs', 'branches'],
      protectedBranches: null,
    };
    expect(isReadOnly(ctx({ headerValue: 'true', grant }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isReadOnly – priority 3: grant preset
// ---------------------------------------------------------------------------
describe('isReadOnly – grant preset priority', () => {
  it('production_use preset -> read-only', () => {
    const grant: GrantContext = {
      projectId: null,
      preset: 'production_use',
      scopes: null,
      protectedBranches: null,
    };
    expect(isReadOnly(ctx({ grant }))).toBe(true);
  });

  it('full_access preset -> not read-only', () => {
    const grant: GrantContext = {
      projectId: null,
      preset: 'full_access',
      scopes: null,
      protectedBranches: null,
    };
    expect(isReadOnly(ctx({ grant }))).toBe(false);
  });

  it('local_development preset -> not read-only', () => {
    const grant: GrantContext = {
      projectId: null,
      preset: 'local_development',
      scopes: null,
      protectedBranches: null,
    };
    expect(isReadOnly(ctx({ grant }))).toBe(false);
  });

  it('custom preset -> not read-only', () => {
    const grant: GrantContext = {
      projectId: null,
      preset: 'custom',
      scopes: ['docs'],
      protectedBranches: null,
    };
    expect(isReadOnly(ctx({ grant }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isReadOnly – priority 4: OAuth scope
// ---------------------------------------------------------------------------
describe('isReadOnly – OAuth scope priority', () => {
  it('"read" only scope -> read-only', () => {
    expect(isReadOnly(ctx({ scope: 'read' }))).toBe(true);
  });

  it('"read write" scope -> not read-only', () => {
    expect(isReadOnly(ctx({ scope: 'read write' }))).toBe(false);
  });

  it('array ["read"] -> read-only', () => {
    expect(isReadOnly(ctx({ scope: ['read'] }))).toBe(true);
  });

  it('array ["read", "write"] -> not read-only', () => {
    expect(isReadOnly(ctx({ scope: ['read', 'write'] }))).toBe(false);
  });

  it('scope with "*" -> not read-only', () => {
    expect(isReadOnly(ctx({ scope: '*' }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isReadOnly – whitespace trimming in header values
// ---------------------------------------------------------------------------
describe('isReadOnly – whitespace trimming', () => {
  it('trims whitespace from X-Neon-Read-Only: "  true  "', () => {
    expect(isReadOnly(ctx({ neonHeaderValue: '  true  ' }))).toBe(true);
  });

  it('trims whitespace from X-Neon-Read-Only: "  false  "', () => {
    expect(isReadOnly(ctx({ neonHeaderValue: '  false  ' }))).toBe(false);
  });

  it('trims whitespace from x-read-only: "  true  "', () => {
    expect(isReadOnly(ctx({ headerValue: '  true  ' }))).toBe(true);
  });

  it('trims whitespace from x-read-only: "  false  "', () => {
    expect(isReadOnly(ctx({ headerValue: '  false  ' }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isReadOnly – non-boolean header values
// ---------------------------------------------------------------------------
describe('isReadOnly – non-boolean values return false (not read-only)', () => {
  const nonBooleanValues = ['1', 'yes', 'on', 'enabled', '0', 'no', 'off', ''];

  for (const value of nonBooleanValues) {
    it(`X-Neon-Read-Only: "${value}" -> false`, () => {
      expect(isReadOnly(ctx({ neonHeaderValue: value }))).toBe(false);
    });

    it(`x-read-only: "${value}" -> false`, () => {
      expect(isReadOnly(ctx({ headerValue: value }))).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// isReadOnly – default
// ---------------------------------------------------------------------------
describe('isReadOnly – default behavior', () => {
  it('returns false when no context is provided', () => {
    expect(isReadOnly(ctx())).toBe(false);
  });

  it('returns false when all context values are null/undefined', () => {
    expect(
      isReadOnly(
        ctx({ headerValue: null, scope: null, grant: undefined }),
      ),
    ).toBe(false);
  });
});
