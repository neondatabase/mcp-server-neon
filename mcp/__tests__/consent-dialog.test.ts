import { describe, expect, it } from 'vitest';
import { DEFAULT_GRANT } from '../utils/grant-context';
import {
  buildConsentView,
  isWriteChecked,
  renderConsentHtml,
} from '../oauth/consent-dialog';

describe('isWriteChecked', () => {
  it('is true when the client requested write and the connection is not read-only', () => {
    expect(
      isWriteChecked({
        requestedScopes: ['read', 'write'],
        defaultReadOnly: false,
      }),
    ).toBe(true);
  });

  it('is false when the connection URL requested read-only', () => {
    expect(
      isWriteChecked({
        requestedScopes: ['read', 'write'],
        defaultReadOnly: true,
      }),
    ).toBe(false);
  });

  it('is false when the client requested read without a read-only URL param', () => {
    expect(
      isWriteChecked({
        requestedScopes: ['read'],
        defaultReadOnly: false,
      }),
    ).toBe(false);
  });
});

describe('buildConsentView', () => {
  it('shows all projects and all categories when the resource has no query', () => {
    const view = buildConsentView({
      grant: DEFAULT_GRANT,
      requestedScopes: ['read', 'write'],
      defaultReadOnly: false,
      readOnlyRequestedByConnection: false,
    });

    expect(view.project.kind).toBe('all');
    expect(view.categories.kind).toBe('all');
    expect(view.writeChecked).toBe(true);
    expect(view.readTools.some((tool) => tool.title === 'Search')).toBe(true);
    expect(
      view.writeOnlyTools.some((tool) => tool.title === 'Create project'),
    ).toBe(true);
  });

  it('lists the project and named categories from the grant', () => {
    const view = buildConsentView({
      grant: {
        projectId: 'proj-123',
        scopes: ['querying', 'schema'],
      },
      requestedScopes: ['read', 'write'],
      defaultReadOnly: false,
      readOnlyRequestedByConnection: false,
    });

    expect(view.project).toEqual({ kind: 'one', projectId: 'proj-123' });
    expect(view.categories).toEqual({
      kind: 'subset',
      labels: ['Querying', 'Schema'],
    });
    expect(view.readTools.some((tool) => tool.title === 'Search')).toBe(false);
    expect(
      view.readTools.some((tool) => tool.title === 'Get Database Tables'),
    ).toBe(true);
  });

  it('uses the checkbox state for write tools, not defaultReadOnly alone', () => {
    const view = buildConsentView({
      grant: DEFAULT_GRANT,
      requestedScopes: ['read'],
      defaultReadOnly: false,
      readOnlyRequestedByConnection: false,
    });

    expect(view.writeChecked).toBe(false);
    expect(
      view.writeOnlyTools.some((tool) => tool.title === 'Create project'),
    ).toBe(true);
  });

  it('describes an empty category list without a project as search and fetch only', () => {
    const view = buildConsentView({
      grant: { projectId: null, scopes: [] },
      requestedScopes: ['read', 'write'],
      defaultReadOnly: false,
      readOnlyRequestedByConnection: false,
    });

    expect(view.categories.kind).toBe('none');
    expect(view.readTools.map((tool) => tool.name).sort()).toEqual([
      'fetch',
      'search',
    ]);
    expect(view.writeOnlyTools).toEqual([]);
  });

  it('describes an empty category list with a project as no tools', () => {
    const view = buildConsentView({
      grant: { projectId: 'proj-123', scopes: [] },
      requestedScopes: ['read', 'write'],
      defaultReadOnly: false,
      readOnlyRequestedByConnection: false,
    });

    expect(view.readTools).toEqual([]);
    expect(view.writeOnlyTools).toEqual([]);
  });
});

describe('renderConsentHtml', () => {
  const client = {
    client_name: 'Cursor',
    redirect_uris: ['http://127.0.0.1:1/callback'],
  };

  it('escapes a project id that looks like HTML', () => {
    const html = renderConsentHtml({
      client,
      state: 'abc',
      requestedScopes: ['read', 'write'],
      defaultReadOnly: false,
      readOnlyRequestedByConnection: false,
      grant: {
        projectId: '<script>alert(1)</script>',
        scopes: ['querying'],
      },
    });

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('states that writes stay limited to the listed project and categories', () => {
    const html = renderConsentHtml({
      client,
      state: 'abc',
      requestedScopes: ['read', 'write'],
      defaultReadOnly: false,
      readOnlyRequestedByConnection: false,
      grant: {
        projectId: 'proj-123',
        scopes: ['querying'],
      },
    });

    expect(html).toContain('proj-123');
    expect(html).toContain('Querying');
    expect(html).toContain(
      'Allow changes through tools in the project and categories shown above.',
    );
    expect(html).toContain('sign in to Neon');
  });

  it('notes when the connection URL requested read-only', () => {
    const html = renderConsentHtml({
      client,
      state: 'abc',
      requestedScopes: ['read', 'write'],
      defaultReadOnly: true,
      readOnlyRequestedByConnection: true,
      grant: DEFAULT_GRANT,
    });

    expect(html).toContain(
      'This connection requested read-only access. You can allow writes for this authorization.',
    );
    const writeInput = html.match(
      /<input[\s\S]*?name="scopes"[\s\S]*?value="write"[\s\S]*?class="scope-checkbox"[\s\S]*?\/>/,
    )?.[0];
    expect(writeInput).toBeTruthy();
    expect(writeInput).not.toContain('checked');
  });

  it('does not claim the connection URL requested read-only when only defaultReadOnly is set', () => {
    const html = renderConsentHtml({
      client,
      state: 'abc',
      requestedScopes: ['read', 'write'],
      defaultReadOnly: true,
      readOnlyRequestedByConnection: false,
      grant: DEFAULT_GRANT,
    });

    expect(html).not.toContain(
      'This connection requested read-only access. You can allow writes for this authorization.',
    );
    const writeInput = html.match(
      /<input[\s\S]*?name="scopes"[\s\S]*?value="write"[\s\S]*?class="scope-checkbox"[\s\S]*?\/>/,
    )?.[0];
    expect(writeInput).toBeTruthy();
    expect(writeInput).not.toContain('checked');
  });

  it('hides write-only tools when Allow writes starts unchecked', () => {
    const html = renderConsentHtml({
      client,
      state: 'abc',
      requestedScopes: ['read'],
      defaultReadOnly: false,
      readOnlyRequestedByConnection: false,
      grant: DEFAULT_GRANT,
    });

    expect(html).toContain('data-write-tool');
    expect(html).toContain('Prepare Database Migration');
    expect(html).toContain('Search');
    expect(html).toMatch(/<li[^>]*data-write-tool[^>]*hidden/);
  });

  it('summarizes unrestricted categories and collapses the long tool list', () => {
    const html = renderConsentHtml({
      client,
      state: 'abc',
      requestedScopes: ['read', 'write'],
      defaultReadOnly: false,
      readOnlyRequestedByConnection: false,
      grant: DEFAULT_GRANT,
    });

    expect(html).toContain('Connect Cursor to Neon');
    expect(html).toContain('All categories');
    expect(html).toContain('Allow writes');
    expect(html).toContain('data-tool-toggle');
    expect(html).toContain('is-collapsed');
    expect(html).toContain('Tools ·');
    expect(html).toContain('tool-scroll');
  });
});
