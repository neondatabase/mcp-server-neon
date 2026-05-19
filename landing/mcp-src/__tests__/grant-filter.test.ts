import { describe, it, expect } from 'vitest';
import {
  filterToolsForGrant,
  getAvailableTools,
  getFilteredTools,
  getAccessControlNotices,
  getAccessControlWarnings,
  injectProjectId,
} from '../tools/grant-filter';
import type { GrantContext, ScopeCategory } from '../utils/grant-context';
import { NEON_TOOLS } from '../tools/definitions';

function grant(overrides: Partial<GrantContext> = {}): GrantContext {
  return {
    projectId: null,
    scopes: null,
    ...overrides,
  };
}

describe('filterToolsForGrant', () => {
  it('returns all tools when no scopes and no project id', () => {
    const tools = filterToolsForGrant(NEON_TOOLS, grant());
    expect(tools).toHaveLength(NEON_TOOLS.length);
  });

  it('filters by scope categories', () => {
    const tools = filterToolsForGrant(
      NEON_TOOLS,
      grant({ scopes: ['querying'] }),
    );
    const names = tools.map((t) => t.name);
    expect(tools).toHaveLength(10);
    expect(names).toContain('run_sql');
    expect(names).toContain('search');
    expect(names).toContain('fetch');
    expect(names).not.toContain('create_project');
  });

  it('returns only always-available tools when scopes are empty', () => {
    const tools = filterToolsForGrant(NEON_TOOLS, grant({ scopes: [] }));
    expect(tools.map((t) => t.name).sort()).toEqual(['fetch', 'search']);
  });

  it('hides project-agnostic tools in project-scoped mode', () => {
    const tools = filterToolsForGrant(
      NEON_TOOLS,
      grant({ projectId: 'proj-123', scopes: null }),
    );
    const names = tools.map((t) => t.name);
    expect(tools).toHaveLength(24);
    expect(names).not.toContain('list_projects');
    expect(names).not.toContain('create_project');
    expect(names).not.toContain('search');
    expect(names).not.toContain('fetch');
    expect(names).toContain('describe_project');
  });

  it('combines scope and project filtering', () => {
    const tools = filterToolsForGrant(
      NEON_TOOLS,
      grant({ projectId: 'proj-123', scopes: ['querying'] }),
    );
    expect(tools).toHaveLength(8);
    const names = tools.map((t) => t.name);
    expect(names).toContain('run_sql');
    expect(names).not.toContain('search');
    expect(names).not.toContain('fetch');
  });
});

describe('getAvailableTools', () => {
  it('applies read-only filter after grant filtering', () => {
    const tools = getAvailableTools(grant({ scopes: ['querying'] }), true);
    expect(tools).toHaveLength(6);
    for (const tool of tools) {
      expect(tool.readOnlySafe).toBe(true);
    }
  });

  it('keeps full toolset when readOnly is false', () => {
    const tools = getAvailableTools(grant(), false);
    expect(tools).toHaveLength(NEON_TOOLS.length);
  });

  it('appends read-only notice to tool descriptions when read-only is enabled', () => {
    const tools = getAvailableTools(grant(), true);
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.description).toContain(
        'configured with read-only permissions',
      );
      expect(tool.description).toContain('<notice>');
    }
  });

  it('appends project-scoped notice with project id to tool descriptions', () => {
    const tools = getAvailableTools(grant({ projectId: 'proj-123' }), false);
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.description).toContain(
        'configured and scoped to one project only (proj-123)',
      );
    }
  });
});

describe('getFilteredTools (no notice suffix)', () => {
  // Issue #257: the REST endpoint surfaces notices as a top-level field,
  // so the filtered tool list must NOT carry the <notice> block in
  // descriptions. The MCP-protocol path (getAvailableTools) keeps the
  // notice inline as today.

  it('returns the same set of tools as getAvailableTools', () => {
    const filtered = getFilteredTools(grant({ scopes: ['querying'] }), false);
    const available = getAvailableTools(grant({ scopes: ['querying'] }), false);
    expect(filtered.map((t) => t.name).sort()).toEqual(
      available.map((t) => t.name).sort(),
    );
  });

  it('does NOT append the read-only notice to tool descriptions', () => {
    const tools = getFilteredTools(grant(), true);
    for (const tool of tools) {
      expect(tool.description).not.toContain('<notice>');
      expect(tool.description).not.toContain('read-only permissions');
    }
  });

  it('does NOT append the project-scope notice to tool descriptions', () => {
    const tools = getFilteredTools(grant({ projectId: 'p-1' }), false);
    for (const tool of tools) {
      expect(tool.description).not.toContain('<notice>');
      expect(tool.description).not.toContain('scoped to one project only');
    }
  });
});

describe('getAccessControlNotices', () => {
  it('returns empty array when neither read-only nor project-scoped', () => {
    expect(getAccessControlNotices(grant(), false)).toEqual([]);
  });

  it('returns the read-only notice when readOnly=true', () => {
    const notices = getAccessControlNotices(grant(), true);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('read-only permissions');
  });

  it('returns the project-scope notice when projectId is set', () => {
    const notices = getAccessControlNotices(grant({ projectId: 'p-1' }), false);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('scoped to one project only (p-1)');
  });

  it('returns both notices when both modes are active', () => {
    const notices = getAccessControlNotices(grant({ projectId: 'p-1' }), true);
    expect(notices).toHaveLength(2);
  });

  it('produces the same notices that getAvailableTools concatenates', () => {
    // Round-trip guard: the MCP-protocol path concatenates the same notices
    // we surface separately. If the strings ever drift, the regression
    // shows up here.
    const tools = getAvailableTools(grant({ projectId: 'p-1' }), true);
    const notices = getAccessControlNotices(grant({ projectId: 'p-1' }), true);
    for (const tool of tools) {
      for (const notice of notices) {
        expect(tool.description).toContain(notice);
      }
    }
  });
});

describe('getAccessControlWarnings', () => {
  it('warns when no valid scope categories are set', () => {
    const warnings = getAccessControlWarnings(grant({ scopes: [] }), false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('No valid scope categories');
  });

  it('warns with no-tools message when project-scoped and scopes are invalid', () => {
    const warnings = getAccessControlWarnings(
      grant({ projectId: 'proj-123', scopes: [] }),
      false,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('No tools are available.');
  });

  it('returns no warnings for null or valid scopes when no access restrictions are set', () => {
    expect(getAccessControlWarnings(grant({ scopes: null }), false)).toEqual(
      [],
    );
    expect(
      getAccessControlWarnings(grant({ scopes: ['schema'] }), false),
    ).toEqual([]);
  });
});

describe('injectProjectId', () => {
  it('injects project id when grant is project-scoped', () => {
    const args = { branchId: 'br-1' };
    expect(injectProjectId(args, grant({ projectId: 'proj-123' }))).toEqual({
      branchId: 'br-1',
      projectId: 'proj-123',
    });
  });

  it('returns args unchanged when not project-scoped', () => {
    const args = { projectId: 'proj-keep', branchId: 'br-1' };
    expect(injectProjectId(args, grant())).toEqual(args);
  });
});

describe('scope coverage sanity', () => {
  it('all declared scope categories produce a deterministic result', () => {
    const categories: ScopeCategory[] = [
      'projects',
      'branches',
      'schema',
      'querying',
      'neon_auth',
      'data_api',
      'docs',
    ];

    for (const category of categories) {
      const tools = filterToolsForGrant(
        NEON_TOOLS,
        grant({ scopes: [category] }),
      );
      expect(tools.length).toBeGreaterThanOrEqual(2);
    }
  });
});
