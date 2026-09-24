import { describe, it, expect } from 'vitest';
import {
  isDocsOnlyRequest,
  resolveGrantFromSearchParams,
  resolveGrantFromResourceUri,
  resolveGrantFromToken,
  parseScopeCategories,
  DEFAULT_GRANT,
  InvalidRoleNameError,
  normalizeStoredGrant,
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
      unknownCategories: ['invalid'],
    });
  });

  it('returns empty scopes array when all categories are invalid', () => {
    expect(
      resolveGrantFromSearchParams(params({ category: 'foo,bar' })),
    ).toEqual({
      projectId: null,
      scopes: [],
      unknownCategories: ['foo', 'bar'],
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

describe('pinned roleName', () => {
  it('is absent from the grant when the param is absent', () => {
    const grant = resolveGrantFromSearchParams(
      new URLSearchParams('projectId=example-project-123'),
    );
    expect(grant).not.toHaveProperty('roleName');
  });

  it.each(['mcp_pinned_reader', 'Reader', '_r', 'r$1', 'r'.repeat(63)])(
    'accepts the Postgres identifier %s verbatim',
    (roleName) => {
      const params = new URLSearchParams({ roleName });
      expect(resolveGrantFromSearchParams(params).roleName).toBe(roleName);
    },
  );

  it.each([
    ['empty', 'roleName='],
    ['whitespace only', 'roleName=%20'],
    ['padded', 'roleName=%20reader'],
    ['a space', 'roleName=bad%20role'],
    ['a quote', 'roleName=a%22b'],
    ['a semicolon', 'roleName=x%3Bdrop'],
    ['a hyphen', 'roleName=a-b'],
    ['a leading digit', 'roleName=1abc'],
    ['64 characters', `roleName=${'r'.repeat(64)}`],
    ['non-ASCII', 'roleName=r%C3%B4le'],
    ['repeated', 'roleName=a&roleName=b'],
    ['repeated identically', 'roleName=a&roleName=a'],
  ])('rejects %s instead of normalizing it', (_label, query) => {
    expect(() =>
      resolveGrantFromSearchParams(new URLSearchParams(query)),
    ).toThrow(InvalidRoleNameError);
  });

  it('reads roleName from an OAuth resource URI', () => {
    expect(
      resolveGrantFromResourceUri(
        'https://mcp.neon.tech/mcp?readonly=true&roleName=mcp_pinned_reader',
      ),
    ).toEqual({
      projectId: null,
      scopes: null,
      roleName: 'mcp_pinned_reader',
    });
  });

  it('rejects a malformed roleName on an OAuth resource URI', () => {
    expect(() =>
      resolveGrantFromResourceUri('https://mcp.neon.tech/mcp?roleName=a-b'),
    ).toThrow(InvalidRoleNameError);
  });

  it('round-trips roleName through a stored token', () => {
    const grant: GrantContext = {
      projectId: 'example-project-123',
      scopes: ['querying'],
      roleName: 'mcp_pinned_reader',
    };
    const stored = JSON.parse(JSON.stringify({ grant })) as {
      grant: GrantContext;
    };
    expect(resolveGrantFromToken(stored)).toEqual(grant);
  });

  it('reads a legacy token grant without roleName as unpinned', () => {
    const legacy = {
      grant: { projectId: 'example-project-123', scopes: null },
    };
    const resolved = resolveGrantFromToken(legacy);
    expect(resolved).toEqual({
      projectId: 'example-project-123',
      scopes: null,
    });
    expect(resolved).not.toHaveProperty('roleName');
    expect(resolveGrantFromToken({})).toEqual(DEFAULT_GRANT);
  });

  it('refuses a stored grant whose roleName is no longer valid', () => {
    expect(() =>
      normalizeStoredGrant({
        projectId: null,
        scopes: null,
        roleName: 'bad role',
      }),
    ).toThrow(InvalidRoleNameError);
  });
});
