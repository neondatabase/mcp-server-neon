import { describe, it, expect } from 'vitest';
import { z } from 'zod/v3';
import {
  filterToolsForGrant,
  getAvailableTools,
  getFilteredTools,
  getAccessControlNotices,
  getAccessControlWarnings,
  formatAccessControlInstructions,
  injectProjectId,
} from '../tools/grant-filter';
import type { GrantContext } from '../utils/grant-context';
import { SCOPE_CATEGORIES } from '../utils/grant-context';
import { NEON_TOOLS } from '../tools/definitions';

function isZod4Object(
  schema: unknown,
): schema is { shape: Record<string, unknown> } {
  return (
    typeof schema === 'object' &&
    schema !== null &&
    '_zod' in schema &&
    'shape' in schema
  );
}

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
    expect(tools).toHaveLength(11);
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
    expect(tools).toHaveLength(
      NEON_TOOLS.filter((tool) => tool.projectScoped).length,
    );
    expect(names).not.toContain('list_projects');
    expect(names).not.toContain('create_project');
    expect(names).not.toContain('delete_project');
    expect(names).not.toContain('projects_permissions_grant');
    expect(names).not.toContain('projects_members_set_role');
    expect(names).not.toContain('search');
    expect(names).not.toContain('fetch');
    expect(names).toContain('describe_project');
    expect(names).toContain('list_project_members');
  });

  it('strips host and generated project_id from published schemas', () => {
    const tools = filterToolsForGrant(
      NEON_TOOLS,
      grant({ projectId: 'proj-123' }),
    );

    const runSql = tools.find((tool) => tool.name === 'run_sql');
    expect(runSql).toBeDefined();
    expect(runSql?.inputSchema instanceof z.ZodObject).toBe(true);
    if (!(runSql?.inputSchema instanceof z.ZodObject)) {
      throw new Error('run_sql must keep a Zod 3 object schema');
    }
    expect('project_id' in runSql.inputSchema.shape).toBe(false);
    expect('sql' in runSql.inputSchema.shape).toBe(true);
    expect(runSql.inputSchema.safeParse({ sql: 'select 1' }).success).toBe(
      true,
    );
    expect(
      runSql.inputSchema.safeParse({ sql: 'select 1', projectId: 'p' }).success,
    ).toBe(false);
    expect(
      runSql.inputSchema.safeParse({ sql: 'select 1', project_id: 'p' })
        .success,
    ).toBe(false);

    const getProject = tools.find((tool) => tool.name === 'describe_project');
    expect(getProject && isZod4Object(getProject.inputSchema)).toBe(true);
    if (!getProject || !isZod4Object(getProject.inputSchema)) {
      throw new Error('describe_project must keep a Zod 4 object schema');
    }
    expect('project_id' in getProject.inputSchema.shape).toBe(false);

    const queryLogs = tools.find((tool) => tool.name === 'query_logs');
    expect(queryLogs && isZod4Object(queryLogs.inputSchema)).toBe(true);
    if (!queryLogs || !isZod4Object(queryLogs.inputSchema)) {
      throw new Error('query_logs must keep a Zod 4 object schema');
    }
    expect('project_id' in queryLogs.inputSchema.shape).toBe(false);
    expect('branch_id' in queryLogs.inputSchema.shape).toBe(true);
    expect(
      queryLogs.inputSchema.safeParse({
        branch_id: 'br-1',
      }).success,
    ).toBe(true);
    expect(
      queryLogs.inputSchema.safeParse({
        branch_id: 'br-1',
        projectId: 'p',
      }).success,
    ).toBe(false);

    const restoreSnapshot = tools.find(
      (tool) => tool.name === 'restore_snapshot',
    );
    expect(restoreSnapshot && isZod4Object(restoreSnapshot.inputSchema)).toBe(
      true,
    );
    if (!restoreSnapshot || !isZod4Object(restoreSnapshot.inputSchema)) {
      throw new Error('restore_snapshot must keep a Zod 4 object schema');
    }
    expect('project_id' in restoreSnapshot.inputSchema.shape).toBe(false);
    expect(
      restoreSnapshot.inputSchema.safeParse({
        snapshot_id: 'ss-1',
        targetBranchId: 'br-intended',
      }).success,
    ).toBe(false);
  });

  it('combines scope and project filtering', () => {
    const tools = filterToolsForGrant(
      NEON_TOOLS,
      grant({ projectId: 'proj-123', scopes: ['querying'] }),
    );
    expect(tools).toHaveLength(9);
    const names = tools.map((t) => t.name);
    expect(names).toContain('run_sql');
    expect(names).not.toContain('search');
    expect(names).not.toContain('fetch');
  });
});

describe('getAvailableTools', () => {
  it('applies read-only filter after grant filtering', () => {
    const tools = getAvailableTools(grant({ scopes: ['querying'] }), true);
    expect(tools).toHaveLength(7);
    for (const tool of tools) {
      expect(tool.readOnlySafe).toBe(true);
    }
  });

  it('keeps full toolset when readOnly is false', () => {
    const tools = getAvailableTools(grant(), false);
    expect(tools).toHaveLength(NEON_TOOLS.length);
  });

  it('does not copy access-control notices into tool descriptions', () => {
    const tools = getAvailableTools(grant({ projectId: 'proj-123' }), true);
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.description).not.toContain('<notice>');
      expect(tool.description).not.toContain('read-only permissions');
      expect(tool.description).not.toContain('scoped to one project only');
    }
  });
});

describe('getFilteredTools (no notice suffix)', () => {
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
  it('emits the write-mode destructive-tools notice by default', () => {
    const notices = getAccessControlNotices(grant(), false);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('Write mode active');
    expect(notices[0]).toContain('destructiveHint');
  });

  it('omits the write-mode notice when no destructive tools are in scope', () => {
    const notices = getAccessControlNotices(grant({ scopes: ['docs'] }), false);
    expect(notices).toEqual([]);
  });

  it('suppresses the write-mode notice in read-only mode', () => {
    const notices = getAccessControlNotices(grant(), true);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('read-only permissions');
    expect(notices[0]).not.toContain('Write mode active');
  });

  it('returns the project-scope notice when projectId is set', () => {
    const notices = getAccessControlNotices(grant({ projectId: 'p-1' }), false);
    expect(
      notices.some((n) => n.includes('scoped to one project only (p-1)')),
    ).toBe(true);
    expect(notices.some((n) => n.includes('Do not send `project_id`'))).toBe(
      true,
    );
  });

  it('returns both notices when both modes are active', () => {
    const notices = getAccessControlNotices(grant({ projectId: 'p-1' }), true);
    expect(notices).toHaveLength(2);
  });

  it('joins the same notices into server instructions', () => {
    const scoped = grant({ projectId: 'p-1' });
    const notices = getAccessControlNotices(scoped, true);
    const instructions = formatAccessControlInstructions(scoped, true);
    expect(instructions).toBeDefined();
    for (const notice of notices) {
      expect(instructions).toContain(notice);
    }
  });

  it('names unknown category values on notices, not per-call warnings', () => {
    const mixed = grant({
      scopes: ['branches'],
      unknownCategories: ['compute'],
    });
    expect(
      getAccessControlNotices(mixed, false).some((notice) =>
        notice.includes('compute'),
      ),
    ).toBe(true);
    expect(getAccessControlWarnings(mixed, false)).toEqual([]);
  });

  it('puts unknown-category warnings on server instructions', () => {
    const instructions = formatAccessControlInstructions(
      grant({
        projectId: 'p-1',
        scopes: [],
        unknownCategories: ['compute'],
      }),
      false,
    );
    expect(instructions).toContain('compute');
    expect(instructions).toContain('No tools are available');
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
  it('injects project_id for host and generated tools when grant is project-scoped', () => {
    const args = { branch_id: 'br-1' };
    const scoped = grant({ projectId: 'proj-123' });
    expect(injectProjectId(args, scoped)).toEqual({
      branch_id: 'br-1',
      project_id: 'proj-123',
    });
    expect(
      injectProjectId(args, scoped, {
        kind: 'generated',
        projectScoped: true,
      }),
    ).toEqual({
      branch_id: 'br-1',
      project_id: 'proj-123',
    });
    expect(
      injectProjectId({ sql: 'select 1' }, scoped, {
        kind: 'host',
        projectScoped: true,
      }),
    ).toEqual({
      sql: 'select 1',
      project_id: 'proj-123',
    });
  });

  it('returns args unchanged when not project-scoped', () => {
    const args = { project_id: 'proj-keep', branch_id: 'br-1' };
    expect(injectProjectId(args, grant())).toEqual(args);
  });

  it('does not inject project_id when the tool schema has none', () => {
    const scoped = grant({ projectId: 'proj-123' });
    const getDoc = NEON_TOOLS.find((t) => t.name === 'get_doc_resource');
    const listDocs = NEON_TOOLS.find((t) => t.name === 'list_docs_resources');
    expect(getDoc).toBeDefined();
    expect(listDocs).toBeDefined();
    expect(injectProjectId({ slug: 'docs/x.md' }, scoped, getDoc)).toEqual({
      slug: 'docs/x.md',
    });
    expect(injectProjectId({}, scoped, listDocs)).toEqual({});
  });
});

describe('scope coverage sanity', () => {
  it('all declared scope categories produce a deterministic result', () => {
    for (const category of SCOPE_CATEGORIES) {
      const tools = filterToolsForGrant(
        NEON_TOOLS,
        grant({ scopes: [category] }),
      );
      expect(tools.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('puts compute endpoint tools in endpoints', () => {
    const names = filterToolsForGrant(
      NEON_TOOLS,
      grant({ scopes: ['endpoints'] }),
    )
      .map((tool) => tool.name)
      .filter((name) => name !== 'search' && name !== 'fetch')
      .sort();
    expect(names).toEqual([
      'create_postgres_endpoint',
      'delete_postgres_endpoint',
      'get_postgres_endpoint',
      'list_branch_computes',
      'list_postgres_endpoints',
      'restart_postgres_endpoint',
      'start_postgres_endpoint',
      'suspend_postgres_endpoint',
      'update_postgres_endpoint',
    ]);
  });

  it('puts snapshot tools in snapshots', () => {
    const names = filterToolsForGrant(
      NEON_TOOLS,
      grant({ scopes: ['snapshots'] }),
    )
      .map((tool) => tool.name)
      .filter((name) => name !== 'search' && name !== 'fetch')
      .sort();
    expect(names).toEqual([
      'create_snapshot',
      'delete_snapshot',
      'get_snapshot_schedule',
      'list_snapshots',
      'restore_snapshot',
      'set_snapshot_schedule',
      'update_snapshot',
    ]);
  });
});
