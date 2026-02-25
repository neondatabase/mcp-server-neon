import { describe, it, expect } from 'vitest';
import {
  resolveGrantFromHeaders,
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

describe('resolveGrantFromHeaders', () => {
  function headers(map: Record<string, string>): Headers {
    return new Headers(map);
  }

  it('returns default grant when no headers are present', () => {
    expect(resolveGrantFromHeaders(headers({}))).toEqual(DEFAULT_GRANT);
  });

  it('extracts project id and trims whitespace', () => {
    expect(
      resolveGrantFromHeaders(headers({ 'x-neon-project-id': '  proj-123  ' })),
    ).toEqual({
      projectId: 'proj-123',
      scopes: null,
    });
  });

  it('uses parsed scopes when X-Neon-Scopes is provided', () => {
    expect(
      resolveGrantFromHeaders(headers({ 'x-neon-scopes': 'schema,docs' })),
    ).toEqual({
      projectId: null,
      scopes: ['schema', 'docs'],
    });
  });

  it('treats empty X-Neon-Scopes as absent', () => {
    expect(resolveGrantFromHeaders(headers({ 'x-neon-scopes': '' }))).toEqual(
      DEFAULT_GRANT,
    );
  });
});

describe('resolveGrantFromToken', () => {
  it('returns default grant when token has no grant', () => {
    expect(resolveGrantFromToken({})).toEqual(DEFAULT_GRANT);
  });

  it('returns token grant when present', () => {
    const tokenGrant: GrantContext = {
      projectId: 'proj-from-token',
      scopes: ['branches'],
    };

    expect(resolveGrantFromToken({ grant: tokenGrant })).toBe(tokenGrant);
  });
});
