import { describe, it, expect } from 'vitest';
import {
  grantsAreEquivalent,
  isDocsOnlyRequest,
  resolveGrantFromSearchParams,
  resolveGrantFromResourceUri,
  resolveGrantFromToken,
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

describe('resolveGrantFromResourceUri', () => {
  it('returns default grant when resource is absent', () => {
    expect(resolveGrantFromResourceUri(undefined)).toEqual(DEFAULT_GRANT);
    expect(resolveGrantFromResourceUri(null)).toEqual(DEFAULT_GRANT);
  });

  it('parses grant query params from resource URI', () => {
    expect(
      resolveGrantFromResourceUri(
        'https://mcp.neon.tech/mcp?projectId=proj-123&category=querying,schema',
      ),
    ).toEqual({
      projectId: 'proj-123',
      scopes: ['querying', 'schema'],
    });
  });

  it('throws when resource URI includes a fragment', () => {
    expect(() =>
      resolveGrantFromResourceUri('https://mcp.neon.tech/mcp#fragment'),
    ).toThrow('OAuth resource URI must not include a fragment');
  });

  it('throws when resource URI is not absolute', () => {
    expect(() =>
      resolveGrantFromResourceUri('/mcp?category=querying'),
    ).toThrow();
  });

  it('throws when resource URI is not https', () => {
    expect(() =>
      resolveGrantFromResourceUri('http://mcp.neon.tech/mcp?category=querying'),
    ).toThrow('OAuth resource URI must use HTTPS');
  });

  it('ignores non-grant query params in resource URI', () => {
    expect(
      resolveGrantFromResourceUri(
        'https://mcp.neon.tech/mcp?readonly=true&foo=bar',
      ),
    ).toEqual({
      projectId: null,
      scopes: null,
    });
  });
});

describe('isDocsOnlyRequest', () => {
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

  it('returns false for empty params', () => {
    expect(isDocsOnlyRequest(new URLSearchParams())).toBe(false);
  });

  it('returns true for ?category=docs', () => {
    expect(isDocsOnlyRequest(params({ category: 'docs' }))).toBe(true);
  });

  it('returns true for ?category=docs with whitespace', () => {
    expect(isDocsOnlyRequest(params({ category: '  docs  ' }))).toBe(true);
  });

  it('returns false for category=docs combined with other categories (comma-separated)', () => {
    expect(isDocsOnlyRequest(params({ category: 'docs,querying' }))).toBe(
      false,
    );
  });

  it('returns false for category=docs combined with other categories (repeated)', () => {
    expect(isDocsOnlyRequest(params({ category: ['docs', 'querying'] }))).toBe(
      false,
    );
  });

  it('returns false for category=docs with a projectId', () => {
    expect(
      isDocsOnlyRequest(params({ category: 'docs', projectId: 'proj-1' })),
    ).toBe(false);
  });

  it('returns false for category=querying alone', () => {
    expect(isDocsOnlyRequest(params({ category: 'querying' }))).toBe(false);
  });

  it('returns false when no category is provided', () => {
    expect(isDocsOnlyRequest(params({ readonly: 'true' }))).toBe(false);
  });

  it('returns true when other unrelated params are present', () => {
    expect(
      isDocsOnlyRequest(params({ category: 'docs', readonly: 'true' })),
    ).toBe(true);
  });
});

describe('grantsAreEquivalent', () => {
  it('returns false when the stored grant is missing', () => {
    expect(grantsAreEquivalent(undefined, DEFAULT_GRANT)).toBe(false);
  });

  it('treats two default grants as equivalent', () => {
    expect(grantsAreEquivalent(DEFAULT_GRANT, DEFAULT_GRANT)).toBe(true);
  });

  it('returns true when scopes match in any order with the same projectId', () => {
    expect(
      grantsAreEquivalent(
        { projectId: 'proj-1', scopes: ['querying', 'schema'] },
        { projectId: 'proj-1', scopes: ['schema', 'querying'] },
      ),
    ).toBe(true);
  });

  it('returns false when projectId differs', () => {
    expect(
      grantsAreEquivalent(
        { projectId: 'proj-a', scopes: ['querying'] },
        { projectId: 'proj-b', scopes: ['querying'] },
      ),
    ).toBe(false);
  });

  it('treats null and an empty list as distinct', () => {
    // `null` means "unconstrained, every category (including future ones)";
    // `[]` means "explicitly zero categories — only always-available
    // tools". Re-consent must fire across this boundary.
    expect(
      grantsAreEquivalent(
        { projectId: null, scopes: null },
        { projectId: null, scopes: [] },
      ),
    ).toBe(false);
  });

  it('treats null and a 7-element list as distinct', () => {
    // Even when an explicit list happens to span every current category,
    // the meaning differs from `null`: future category additions would
    // silently widen a `null`-grant approval but would still require
    // re-consent for the explicit list.
    expect(
      grantsAreEquivalent(
        { projectId: null, scopes: null },
        {
          projectId: null,
          scopes: [
            'projects',
            'branches',
            'schema',
            'querying',
            'neon_auth',
            'data_api',
            'docs',
          ],
        },
      ),
    ).toBe(false);
  });

  it('returns false when scope sets differ', () => {
    expect(
      grantsAreEquivalent(
        { projectId: null, scopes: ['querying', 'schema'] },
        { projectId: null, scopes: ['querying', 'branches'] },
      ),
    ).toBe(false);
  });

  it('regression: ignores duplicate scope entries on either side', () => {
    // Earlier implementation compared `aScopes.length` vs
    // `bScopes.length` and then ran a one-directional `setA.has(s)`
    // loop, so stored `['querying', 'schema']` matched incoming
    // `['querying', 'querying']` (both length 2) and silently bypassed
    // re-consent. Going through `Set.size` collapses duplicates.
    expect(
      grantsAreEquivalent(
        { projectId: null, scopes: ['querying', 'schema'] },
        { projectId: null, scopes: ['querying', 'querying'] },
      ),
    ).toBe(false);

    // The reverse direction must also be false.
    expect(
      grantsAreEquivalent(
        { projectId: null, scopes: ['querying', 'querying'] },
        { projectId: null, scopes: ['querying', 'schema'] },
      ),
    ).toBe(false);

    // But two grants that *only* differ by harmless duplication of the
    // same entries are still equivalent (same set, same projectId).
    expect(
      grantsAreEquivalent(
        { projectId: null, scopes: ['querying', 'querying'] },
        { projectId: null, scopes: ['querying'] },
      ),
    ).toBe(true);
  });

  it('handles undefined projectId and null projectId as the same', () => {
    expect(
      grantsAreEquivalent(
        { projectId: null, scopes: null },
        // GrantContext.projectId is `string | null` per the type, but
        // legacy stored records may carry `undefined`. The function
        // normalizes via `?? null` so they compare equal.
        { projectId: undefined as unknown as null, scopes: null },
      ),
    ).toBe(true);
  });
});
