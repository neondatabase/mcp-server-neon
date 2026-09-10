import { describe, expect, it } from 'vitest';
import {
  filterConsentCatalog,
  getConsentToolCatalog,
} from '../oauth/consent-tools';
import { getFilteredTools } from '../tools/grant-filter';
import { COLLAPSE_ABOVE } from '../oauth/consent-dialog';
import { DEFAULT_GRANT } from '../utils/grant-context';

describe('filterConsentCatalog', () => {
  const catalog = getConsentToolCatalog();

  it('matches getFilteredTools for the default grant', () => {
    const readOnly = filterConsentCatalog(catalog, DEFAULT_GRANT, false).map(
      (tool) => tool.name,
    );
    const writable = filterConsentCatalog(catalog, DEFAULT_GRANT, true).map(
      (tool) => tool.name,
    );
    expect(readOnly).toEqual(
      getFilteredTools(DEFAULT_GRANT, true).map((tool) => tool.name),
    );
    expect(writable).toEqual(
      getFilteredTools(DEFAULT_GRANT, false).map((tool) => tool.name),
    );
  });

  it('matches getFilteredTools for a project and category subset', () => {
    const grant = {
      projectId: 'proj-123',
      scopes: ['querying', 'schema'] as const,
    };
    const context = { projectId: grant.projectId, scopes: [...grant.scopes] };
    expect(
      filterConsentCatalog(catalog, context, true).map((tool) => tool.name),
    ).toEqual(getFilteredTools(context, false).map((tool) => tool.name));
  });

  it('keeps search and fetch for no categories without a project', () => {
    const names = filterConsentCatalog(
      catalog,
      { projectId: null, scopes: [] },
      true,
    ).map((tool) => tool.name);
    expect(names.sort()).toEqual(['fetch', 'search']);
  });

  it('has no tools for no categories with a project', () => {
    expect(
      filterConsentCatalog(
        catalog,
        { projectId: 'proj-123', scopes: [] },
        true,
      ),
    ).toEqual([]);
  });

  it('can stay at or below the collapse threshold while hidden write tools exceed it', () => {
    const grant = { projectId: null, scopes: ['branches'] as const };
    const context = { projectId: null, scopes: [...grant.scopes] };
    const visible = filterConsentCatalog(catalog, context, false);
    const withWrites = filterConsentCatalog(catalog, context, true);
    const hiddenWrites = withWrites.length - visible.length;
    expect(visible.length).toBeLessThanOrEqual(COLLAPSE_ABOVE);
    expect(visible.length + hiddenWrites).toBeGreaterThan(COLLAPSE_ABOVE);
  });
});
