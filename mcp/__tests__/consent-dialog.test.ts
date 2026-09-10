import { describe, expect, it } from 'vitest';
import { DEFAULT_GRANT } from '../utils/grant-context';
import { isWriteChecked } from '../oauth/issued-scopes';
import {
  buildConsentView,
  COLLAPSE_ABOVE,
  renderConsentHtml,
  visibleToolCount,
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
      writeChecked: true,
    });

    expect(view.project.kind).toBe('all');
    expect(view.categories.kind).toBe('all');
    expect(view.writeChecked).toBe(true);
    expect(view.tools.some((tool) => tool.title === 'Search')).toBe(true);
    expect(view.tools.some((tool) => tool.title === 'Create project')).toBe(
      true,
    );
  });

  it('lists the project and named categories from the grant', () => {
    const view = buildConsentView({
      grant: {
        projectId: 'proj-123',
        scopes: ['querying', 'schema'],
      },
      writeChecked: true,
    });

    expect(view.project).toEqual({ kind: 'one', projectId: 'proj-123' });
    expect(view.categories).toEqual({
      kind: 'subset',
      labels: ['Querying', 'Schema'],
    });
    expect(view.tools.some((tool) => tool.title === 'Search')).toBe(false);
    expect(
      view.tools.some((tool) => tool.title === 'Get Database Tables'),
    ).toBe(true);
  });

  it('keeps write-only tools in the catalog when writes are off', () => {
    const view = buildConsentView({
      grant: DEFAULT_GRANT,
      writeChecked: false,
    });

    expect(view.writeChecked).toBe(false);
    expect(view.tools.some((tool) => tool.title === 'Create project')).toBe(
      false,
    );
  });

  it('describes an empty category list without a project as search and fetch only', () => {
    const view = buildConsentView({
      grant: { projectId: null, scopes: [] },
      writeChecked: true,
    });

    expect(view.categories.kind).toBe('none');
    expect(view.tools.map((tool) => tool.name).sort()).toEqual([
      'fetch',
      'search',
    ]);
  });

  it('describes an empty category list with a project as no tools', () => {
    const view = buildConsentView({
      grant: { projectId: 'proj-123', scopes: [] },
      writeChecked: true,
    });

    expect(view.tools).toEqual([]);
  });

  it('does not collapse when hidden write tools alone cross the threshold', () => {
    const readView = buildConsentView({
      grant: { projectId: null, scopes: ['snapshots'] },
      writeChecked: false,
    });
    const writeView = buildConsentView({
      grant: { projectId: null, scopes: ['snapshots'] },
      writeChecked: true,
    });
    expect(visibleToolCount(readView)).toBeLessThanOrEqual(COLLAPSE_ABOVE);
    expect(visibleToolCount(writeView)).toBeGreaterThan(COLLAPSE_ABOVE);
  });
});

describe('renderConsentHtml', () => {
  const client = {
    client_name: 'Cursor',
    redirect_uris: ['http://127.0.0.1:1/callback'],
  };

  it('collapses exact client URLs behind a host summary', () => {
    const html = renderConsentHtml({
      client: {
        client_name: 'Cursor',
        client_uri: 'https://cursor.com/oauth',
        redirect_uris: ['http://127.0.0.1:1/callback'],
      },
      state: 'abc',
      mode: 'confirmation',
      writeChecked: false,
      showWriteControl: false,
      grant: DEFAULT_GRANT,
    });

    expect(html).toContain(
      '<summary><span>App details · cursor.com → 127.0.0.1:1</span></summary>',
    );
    expect(html).toContain('<details class="client-verify">');
    expect(html).not.toContain('<details class="client-verify" open>');
    expect(html).toContain('https://cursor.com/oauth');
    expect(html).toContain('http://127.0.0.1:1/callback');
    expect(html).not.toContain('class="client-name"');
  });

  it('summarizes multiple redirect URIs without dropping their exact values', () => {
    const html = renderConsentHtml({
      client: {
        client_name: 'Cursor',
        client_uri: 'https://cursor.com',
        redirect_uris: [
          'http://127.0.0.1:1/callback',
          'https://cursor.com/oauth/callback',
        ],
      },
      state: 'abc',
      mode: 'confirmation',
      writeChecked: false,
      showWriteControl: false,
      grant: DEFAULT_GRANT,
    });

    expect(html).toContain(
      '<summary><span>App details · cursor.com → 127.0.0.1:1, cursor.com</span></summary>',
    );
    expect(html).toContain('http://127.0.0.1:1/callback');
    expect(html).toContain('https://cursor.com/oauth/callback');
  });

  it('shows non-web client URIs as text instead of links', () => {
    const html = renderConsentHtml({
      client: {
        client_name: 'Cursor',
        client_uri: 'javascript:alert(1)',
        redirect_uris: ['cursor://oauth/callback'],
      },
      state: 'abc',
      mode: 'confirmation',
      writeChecked: false,
      showWriteControl: false,
      grant: DEFAULT_GRANT,
    });

    expect(html).toContain('javascript:alert(1)');
    expect(html).not.toContain('href="javascript:alert(1)"');
  });

  it('uses the redirect host when the client has no website', () => {
    const html = renderConsentHtml({
      client,
      state: 'abc',
      mode: 'confirmation',
      writeChecked: false,
      showWriteControl: false,
      grant: DEFAULT_GRANT,
    });

    expect(html).toContain(
      '<summary><span>App details · Redirects to 127.0.0.1:1</span></summary>',
    );
  });

  it('omits client details when no URLs are registered', () => {
    const html = renderConsentHtml({
      client: { client_name: 'Cursor' },
      state: 'abc',
      mode: 'confirmation',
      writeChecked: false,
      showWriteControl: false,
      grant: DEFAULT_GRANT,
    });

    expect(html).not.toContain('class="client-verify"');
  });

  it('escapes a project id that looks like HTML', () => {
    const html = renderConsentHtml({
      client,
      state: 'abc',
      mode: 'confirmation',
      writeChecked: false,
      showWriteControl: false,
      grant: {
        projectId: '<script>alert(1)</script>',
        scopes: ['querying'],
      },
    });

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('renders confirmation without editors, including for a writable URL', () => {
    const html = renderConsentHtml({
      client,
      state: 'abc',
      mode: 'confirmation',
      writeChecked: true,
      showWriteControl: false,
      grant: {
        projectId: 'proj-123',
        scopes: ['querying'],
      },
    });

    expect(html).toContain('proj-123');
    expect(html).toContain('Querying');
    expect(html).toContain('Read and write');
    expect(html).toContain('<h2>Requested access</h2>');
    expect(html).not.toContain('class="scope-checkbox"');
    expect(html).not.toContain('name="projectMode"');
    expect(html).not.toContain('name="category"');
    expect(html).toContain(
      'To change these limits, update the connection URL and authorize again.',
    );
    expect(html).toContain('name="action" value="cancel"');
    expect(html).toContain('formnovalidate');
    expect(html).not.toContain('history.replaceState');
  });

  it('renders editable project, category, and write controls', () => {
    const html = renderConsentHtml({
      client,
      state: 'abc',
      mode: 'editable',
      writeChecked: true,
      showWriteControl: true,
      grant: DEFAULT_GRANT,
    });

    expect(html).toContain('name="projectMode"');
    expect(html).not.toContain('Next, sign in to Neon');
    expect(html).toContain('<h2>Choose access</h2>');
    expect(html).toContain('class="project-id" hidden');
    expect(html).toContain('name="category"');
    expect(html).toContain('data-category-select-all');
    expect(html).toContain('data-category-clear-all');
    expect(html).toContain('>Clear categories</button>');
    expect(html).toContain(
      'With all projects selected, Search and Fetch remain available.',
    );
    expect(html).toContain('Allow writes');
    expect(html).toContain('src="/favicon.svg"');
    expect(html).toContain('>View tools</button>');
    expect(html).toContain('is-collapsed');
    expect(html).toContain('104 tools · 13 groups');
    expect(html).toContain('tool-scroll');
    expect(html).toContain('data-category-scroll');
    expect(html).toContain('choice-categories');
    expect(html).toMatch(/\.check-grid\s*\{[^}]*overflow-y:\s*auto/);
    expect(html).toMatch(
      /\.check-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2/,
    );
    expect(html).not.toContain('history.replaceState');
  });

  it('disables the project ID field when All projects is selected', () => {
    const html = renderConsentHtml({
      client,
      state: 'abc',
      mode: 'editable',
      writeChecked: true,
      showWriteControl: true,
      grant: DEFAULT_GRANT,
    });
    const input = html.match(
      /<input\b[^>]*name="projectId"[^>]*>|<input\b[\s\S]*?name="projectId"[\s\S]*?>/,
    );
    expect(input?.[0]).toContain('disabled');
    expect(html).toMatch(/data-project-id-help[^>]*hidden/);
  });

  it('enables the project ID field for One project', () => {
    const html = renderConsentHtml({
      client,
      state: 'abc',
      mode: 'editable',
      writeChecked: true,
      showWriteControl: true,
      grant: DEFAULT_GRANT,
      formState: {
        projectMode: 'one',
        projectId: 'proj-123',
        categories: [],
        writeChecked: true,
      },
    });
    const input = html.match(
      /<input\b[^>]*name="projectId"[^>]*>|<input\b[\s\S]*?name="projectId"[\s\S]*?>/,
    );
    expect(input?.[0]).toBeDefined();
    expect(input?.[0]).not.toContain('disabled');
  });

  it('omits Allow writes when the OAuth ceiling is read-only', () => {
    const html = renderConsentHtml({
      client,
      state: 'abc',
      mode: 'editable',
      writeChecked: false,
      showWriteControl: false,
      grant: DEFAULT_GRANT,
    });

    expect(html).toContain('Read-only');
    expect(html).not.toContain('class="scope-checkbox"');
    expect(html).toContain('name="scopes" value="read"');
  });

  it('shows a project ID field error', () => {
    const html = renderConsentHtml({
      client,
      state: 'abc',
      mode: 'editable',
      writeChecked: false,
      showWriteControl: true,
      grant: DEFAULT_GRANT,
      fieldError: {
        field: 'projectId',
        message: 'Enter the project ID this connection should use.',
      },
      formState: {
        projectMode: 'one',
        projectId: '',
        categories: [],
        writeChecked: false,
      },
    });

    expect(html).toContain('Enter the project ID this connection should use.');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('autofocus');
    expect(html).toContain('role="alert"');
  });
});
