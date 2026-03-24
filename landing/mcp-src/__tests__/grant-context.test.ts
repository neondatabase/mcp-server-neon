import { describe, it, expect } from 'vitest';
import {
  resolveGrantFromSearchParams,
  resolveGrantFromToken,
  mergeGrant,
  parseScopeCategories,
  DEFAULT_GRANT,
  type GrantContext,
} from '../utils/grant-context';

describe('parseScopeCategories', () => {
  it('returns null for null/undefined/empty input', () => {
    expect(parseScopeCategories(null)).toBeNull();
    expect(parseScopeCategories(undefined)).toBeNull();
    expect(parseScopeCategories('')).toBeNull();
  });

  it('parses valid categories', () => {
    expect(parseScopeCategories('projects,branches,querying')).toEqual([
      'projects',
      'branches',
      'querying',
    ]);
  });

  it('filters invalid categories', () => {
    expect(parseScopeCategories('projects,invalid,branches')).toEqual([
      'projects',
      'branches',
    ]);
  });

  it('returns [] when header is present but all categories are invalid', () => {
    expect(parseScopeCategories('foo,bar')).toEqual([]);
  });
});

describe('resolveGrantFromSearchParams', () => {
  function params(entries: Record<string, string | string[]>): URLSearchParams {
    const sp = new URLSearchParams();
    for (const [key, value] of Object.entries(entries)) {
      if (Array.isArray(value)) {
        for (const v of value) {
          sp.append(key, v);
        }
      } else {
        sp.set(key, value);
      }
    }
    return sp;
  }

  it('returns default grant when no params are present', () => {
    expect(resolveGrantFromSearchParams(new URLSearchParams())).toEqual(
      DEFAULT_GRANT,
    );
  });

  it('extracts projectId and trims whitespace', () => {
    expect(
      resolveGrantFromSearchParams(params({ projectId: '  proj-123  ' })),
    ).toEqual({
      projectId: 'proj-123',
      scopes: null,
    });
  });

  it('parses repeated category params', () => {
    expect(
      resolveGrantFromSearchParams(params({ category: ['schema', 'docs'] })),
    ).toEqual({
      projectId: null,
      scopes: ['schema', 'docs'],
    });
  });

  it('parses comma-separated category param', () => {
    expect(
      resolveGrantFromSearchParams(params({ category: 'schema,docs' })),
    ).toEqual({
      projectId: null,
      scopes: ['schema', 'docs'],
    });
  });

  it('handles mixed repeated and comma-separated categories', () => {
    expect(
      resolveGrantFromSearchParams(
        params({ category: ['schema,querying', 'docs'] }),
      ),
    ).toEqual({
      projectId: null,
      scopes: ['schema', 'querying', 'docs'],
    });
  });

  it('filters invalid categories', () => {
    expect(
      resolveGrantFromSearchParams(params({ category: 'schema,invalid' })),
    ).toEqual({
      projectId: null,
      scopes: ['schema'],
    });
  });

  it('returns empty scopes array when all categories are invalid', () => {
    expect(
      resolveGrantFromSearchParams(params({ category: 'foo,bar' })),
    ).toEqual({
      projectId: null,
      scopes: [],
    });
  });

  it('treats empty category as absent', () => {
    expect(resolveGrantFromSearchParams(params({ category: '' }))).toEqual(
      DEFAULT_GRANT,
    );
  });
});

describe('resolveGrantFromToken', () => {
  it('returns default grant when token has no grant', () => {
    expect(resolveGrantFromToken({})).toEqual(DEFAULT_GRANT);
  });

  it('normalizes token grant when present', () => {
    const tokenGrant: GrantContext = {
      projectId: 'proj-from-token',
      scopes: ['branches'],
    };

    expect(resolveGrantFromToken({ grant: tokenGrant })).toEqual({
      projectId: 'proj-from-token',
      scopes: ['branches'],
    });
  });
});

describe('mergeGrant', () => {
  it('uses primary values when both are present', () => {
    const primary: GrantContext = {
      projectId: 'proj-url',
      scopes: ['schema'],
    };
    const fallback: GrantContext = {
      projectId: 'proj-token',
      scopes: ['querying'],
    };

    expect(mergeGrant(primary, fallback)).toEqual({
      projectId: 'proj-url',
      scopes: ['schema'],
    });
  });

  it('falls back when primary has nulls', () => {
    const primary: GrantContext = {
      projectId: null,
      scopes: null,
    };
    const fallback: GrantContext = {
      projectId: 'proj-token',
      scopes: ['querying'],
    };

    expect(mergeGrant(primary, fallback)).toEqual({
      projectId: 'proj-token',
      scopes: ['querying'],
    });
  });

  it('uses partial primary + partial fallback', () => {
    const primary: GrantContext = {
      projectId: 'proj-url',
      scopes: null,
    };
    const fallback: GrantContext = {
      projectId: null,
      scopes: ['querying'],
    };

    expect(mergeGrant(primary, fallback)).toEqual({
      projectId: 'proj-url',
      scopes: ['querying'],
    });
  });

  it('returns default when both are default', () => {
    expect(mergeGrant(DEFAULT_GRANT, DEFAULT_GRANT)).toEqual(DEFAULT_GRANT);
  });
});
