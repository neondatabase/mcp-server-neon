import { describe, expect, it } from 'vitest';
import { SCOPE_CATEGORIES, type GrantContext } from '../utils/grant-context';
import { getAvailablePrompts } from '../prompts';

function grant(overrides: Partial<GrantContext> = {}): GrantContext {
  return {
    projectId: null,
    scopes: null,
    ...overrides,
  };
}

describe('getAvailablePrompts', () => {
  it('returns setup-neon-auth when no scope filter is set', () => {
    const prompts = getAvailablePrompts(grant({ scopes: null }));
    expect(prompts.map((p) => p.name)).toContain('setup-neon-auth');
  });

  it('returns setup-neon-auth when neon_auth scope is selected', () => {
    const prompts = getAvailablePrompts(grant({ scopes: ['neon_auth'] }));
    expect(prompts.map((p) => p.name)).toContain('setup-neon-auth');
  });

  it('returns setup-neon-auth when all scope categories are selected', () => {
    const prompts = getAvailablePrompts(
      grant({ scopes: [...SCOPE_CATEGORIES] }),
    );
    expect(prompts.map((p) => p.name)).toContain('setup-neon-auth');
  });

  it('filters setup-neon-auth when neon_auth is not selected', () => {
    const prompts = getAvailablePrompts(
      grant({ scopes: ['querying', 'schema'] }),
    );
    expect(prompts.map((p) => p.name)).not.toContain('setup-neon-auth');
  });

  it('returns no prompts when scopes are explicitly empty', () => {
    const prompts = getAvailablePrompts(grant({ scopes: [] }));
    expect(prompts).toHaveLength(0);
  });
});
