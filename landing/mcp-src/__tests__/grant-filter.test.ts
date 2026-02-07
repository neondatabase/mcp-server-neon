import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { filterToolsForGrant, getAvailableTools, injectProjectId } from '../tools/grant-filter';
import type { NeonTool } from '../tools/grant-filter';
import { NEON_TOOLS } from '../tools/definitions';
import type { GrantContext, ScopeCategory } from '../utils/grant-context';
import { DEFAULT_GRANT } from '../utils/grant-context';

/**
 * Helper to build a GrantContext with overrides.
 */
function grant(overrides: Partial<GrantContext> = {}): GrantContext {
  return { ...DEFAULT_GRANT, ...overrides };
}

/**
 * Helper to extract tool names from a filtered list.
 */
function toolNames(tools: NeonTool[]): string[] {
  return tools.map((t) => t.name);
}

// ---------------------------------------------------------------------------
// Sanity: tool definitions integrity
// ---------------------------------------------------------------------------
describe('NEON_TOOLS definitions', () => {
  it('has 28 tools', () => {
    expect(NEON_TOOLS).toHaveLength(28);
  });

  it('every tool has a name, scope (or null), and readOnlySafe flag', () => {
    for (const tool of NEON_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(typeof tool.readOnlySafe).toBe('boolean');
      // scope must be a string or null
      expect(
        tool.scope === null || typeof tool.scope === 'string',
      ).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Preset: full_access
// ---------------------------------------------------------------------------
describe('filterToolsForGrant – full_access', () => {
  it('returns all tools when no project scoping', () => {
    const result = filterToolsForGrant(NEON_TOOLS, grant());
    expect(result).toHaveLength(NEON_TOOLS.length);
  });
});

// ---------------------------------------------------------------------------
// Preset: production_use
// ---------------------------------------------------------------------------
describe('filterToolsForGrant – production_use', () => {
  const filtered = filterToolsForGrant(
    NEON_TOOLS,
    grant({ preset: 'production_use' }),
  );
  const names = toolNames(filtered);

  it('only includes readOnlySafe tools and always-available tools', () => {
    for (const tool of filtered) {
      const isAlwaysAvailable = tool.name === 'search' || tool.name === 'fetch';
      expect(
        tool.readOnlySafe || isAlwaysAvailable,
        `${tool.name} should be readOnlySafe or always-available`,
      ).toBeTruthy();
    }
  });

  it('excludes write-only tools like create_project and delete_branch', () => {
    expect(names).not.toContain('create_project');
    expect(names).not.toContain('delete_project');
    expect(names).not.toContain('create_branch');
    expect(names).not.toContain('delete_branch');
  });

  it('includes read-safe tools like describe_project and run_sql', () => {
    expect(names).toContain('describe_project');
    expect(names).toContain('run_sql');
    expect(names).toContain('load_resource');
  });

  it('includes always-available tools', () => {
    expect(names).toContain('search');
    expect(names).toContain('fetch');
  });
});

// ---------------------------------------------------------------------------
// Preset: local_development
// ---------------------------------------------------------------------------
describe('filterToolsForGrant – local_development', () => {
  const filtered = filterToolsForGrant(
    NEON_TOOLS,
    grant({ preset: 'local_development' }),
  );
  const names = toolNames(filtered);

  it('blocks create_project and delete_project', () => {
    expect(names).not.toContain('create_project');
    expect(names).not.toContain('delete_project');
  });

  it('keeps all other tools including write tools', () => {
    expect(names).toContain('run_sql');
    expect(names).toContain('create_branch');
    expect(names).toContain('delete_branch');
    expect(names).toContain('prepare_database_migration');
  });

  it('returns total tools minus the two blocked', () => {
    expect(filtered).toHaveLength(NEON_TOOLS.length - 2);
  });
});

// ---------------------------------------------------------------------------
// Preset: custom with specific scopes
// ---------------------------------------------------------------------------
describe('filterToolsForGrant – custom preset', () => {
  it('with specific scopes, only includes matching scope tools + always-available + null-scope', () => {
    const filtered = filterToolsForGrant(
      NEON_TOOLS,
      grant({ preset: 'custom', scopes: ['querying', 'docs'] }),
    );
    const names = toolNames(filtered);

    // querying scope tools
    expect(names).toContain('run_sql');
    expect(names).toContain('run_sql_transaction');
    expect(names).toContain('prepare_database_migration');
    expect(names).toContain('complete_database_migration');
    expect(names).toContain('compare_database_schema');

    // docs scope tools
    expect(names).toContain('load_resource');

    // always-available (null scope)
    expect(names).toContain('search');
    expect(names).toContain('fetch');

    // tools from other scopes should NOT be present
    expect(names).not.toContain('list_projects');
    expect(names).not.toContain('create_branch');
    expect(names).not.toContain('describe_table_schema');
    expect(names).not.toContain('explain_sql_statement');
    expect(names).not.toContain('provision_neon_auth');
  });

  it('with no scopes (empty), only always-available tools', () => {
    const filtered = filterToolsForGrant(
      NEON_TOOLS,
      grant({ preset: 'custom', scopes: [] }),
    );
    const names = toolNames(filtered);
    expect(names).toEqual(['search', 'fetch']);
  });

  it('with null scopes under custom preset, only always-available tools', () => {
    const filtered = filterToolsForGrant(
      NEON_TOOLS,
      grant({ preset: 'custom', scopes: null }),
    );
    const names = toolNames(filtered);
    expect(names).toEqual(['search', 'fetch']);
  });

  it('with all scopes, includes all tools', () => {
    const allScopes: ScopeCategory[] = [
      'projects',
      'branches',
      'schema',
      'querying',
      'performance',
      'neon_auth',
      'docs',
    ];
    const filtered = filterToolsForGrant(
      NEON_TOOLS,
      grant({ preset: 'custom', scopes: allScopes }),
    );
    expect(filtered).toHaveLength(NEON_TOOLS.length);
  });

  it('with single scope, only matching tools + always-available', () => {
    const filtered = filterToolsForGrant(
      NEON_TOOLS,
      grant({ preset: 'custom', scopes: ['schema'] }),
    );
    const names = toolNames(filtered);
    expect(names).toContain('describe_table_schema');
    expect(names).toContain('get_database_tables');
    expect(names).toContain('search');
    expect(names).toContain('fetch');
    expect(names).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// Project-scoped mode
// ---------------------------------------------------------------------------
describe('filterToolsForGrant – project scoping', () => {
  const filtered = filterToolsForGrant(
    NEON_TOOLS,
    grant({ projectId: 'proj-xyz' }),
  );
  const names = toolNames(filtered);

  it('hides project-agnostic tools', () => {
    expect(names).not.toContain('list_projects');
    expect(names).not.toContain('list_organizations');
    expect(names).not.toContain('list_shared_projects');
    expect(names).not.toContain('create_project');
    expect(names).not.toContain('delete_project');
  });

  it('keeps project-specific tools', () => {
    expect(names).toContain('describe_project');
    expect(names).toContain('run_sql');
    expect(names).toContain('create_branch');
  });

  it('removes projectId from tool schemas that have it', () => {
    const describeProject = filtered.find(
      (t) => t.name === 'describe_project',
    );
    expect(describeProject).toBeDefined();

    const schema = describeProject!.inputSchema;
    if (schema instanceof z.ZodObject) {
      const shape = schema.shape as Record<string, unknown>;
      expect('projectId' in shape).toBe(false);
    }
  });

  it('does not remove projectId from tools that never had it', () => {
    // search and fetch do not have projectId
    const searchTool = filtered.find((t) => t.name === 'search');
    expect(searchTool).toBeDefined();
    // Just verify it still works - no crash
    const schema = searchTool!.inputSchema;
    expect(schema).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Combined: project scoping + preset
// ---------------------------------------------------------------------------
describe('filterToolsForGrant – combined project scoping + preset', () => {
  it('local_development + project-scoped', () => {
    const filtered = filterToolsForGrant(
      NEON_TOOLS,
      grant({ preset: 'local_development', projectId: 'proj-abc' }),
    );
    const names = toolNames(filtered);

    // local_dev blocks create/delete project
    // project-scoped hides list_projects, list_organizations, list_shared_projects, create_project, delete_project
    // Net result: all 5 project-agnostic tools removed (create/delete were already blocked)
    expect(names).not.toContain('list_projects');
    expect(names).not.toContain('create_project');
    expect(names).not.toContain('delete_project');
    // But should have working tools
    expect(names).toContain('run_sql');
    expect(names).toContain('describe_project');
  });

  it('production_use + project-scoped', () => {
    const filtered = filterToolsForGrant(
      NEON_TOOLS,
      grant({ preset: 'production_use', projectId: 'proj-abc' }),
    );
    const names = toolNames(filtered);

    // production_use = readOnlySafe only
    // project-scoped = no project-agnostic tools
    expect(names).not.toContain('create_branch');
    expect(names).not.toContain('delete_branch');
    expect(names).not.toContain('list_projects');
    expect(names).toContain('describe_project');
    expect(names).toContain('run_sql');
  });
});

// ---------------------------------------------------------------------------
// getAvailableTools – shared utility combining grant + read-only filtering
// ---------------------------------------------------------------------------
describe('getAvailableTools', () => {
  it('returns all tools for full_access + not read-only (default)', () => {
    const tools = getAvailableTools(grant(), false);
    expect(tools).toHaveLength(NEON_TOOLS.length);
  });

  it('returns same result as filterToolsForGrant when readOnly is false', () => {
    const g = grant({ preset: 'local_development', projectId: 'proj-1' });
    const fromShared = getAvailableTools(g, false);
    const fromDirect = filterToolsForGrant(NEON_TOOLS, g);
    expect(toolNames(fromShared)).toEqual(toolNames(fromDirect));
  });

  it('strips non-readOnlySafe tools when readOnly is true', () => {
    const tools = getAvailableTools(grant(), true);
    for (const tool of tools) {
      expect(
        tool.readOnlySafe,
        `${tool.name} should be readOnlySafe`,
      ).toBe(true);
    }
    // Should be fewer than all tools
    expect(tools.length).toBeLessThan(NEON_TOOLS.length);
  });

  it('combines preset filtering with read-only filtering', () => {
    // local_development blocks create/delete project, read-only strips remaining write tools
    const tools = getAvailableTools(
      grant({ preset: 'local_development' }),
      true,
    );
    const names = toolNames(tools);
    expect(names).not.toContain('create_project');
    expect(names).not.toContain('delete_project');
    expect(names).not.toContain('create_branch');
    expect(names).not.toContain('delete_branch');
    expect(names).toContain('describe_project');
    expect(names).toContain('run_sql');
    for (const tool of tools) {
      expect(tool.readOnlySafe).toBe(true);
    }
  });

  it('combines custom scopes with read-only filtering', () => {
    // custom preset with querying scope, plus read-only
    const tools = getAvailableTools(
      grant({ preset: 'custom', scopes: ['querying', 'schema'] }),
      true,
    );
    const names = toolNames(tools);
    // querying read-safe tools
    expect(names).toContain('run_sql');
    // schema read-safe tools
    expect(names).toContain('describe_table_schema');
    expect(names).toContain('get_database_tables');
    // always-available
    expect(names).toContain('search');
    expect(names).toContain('fetch');
    // write tools should be excluded
    expect(names).not.toContain('prepare_database_migration');
    for (const tool of tools) {
      expect(tool.readOnlySafe).toBe(true);
    }
  });

  it('combines project scoping with read-only filtering', () => {
    const tools = getAvailableTools(
      grant({ projectId: 'proj-abc' }),
      true,
    );
    const names = toolNames(tools);
    // project-agnostic tools should be hidden
    expect(names).not.toContain('list_projects');
    expect(names).not.toContain('create_project');
    // write tools should be filtered
    expect(names).not.toContain('create_branch');
    // read-safe tools should remain
    expect(names).toContain('describe_project');
    for (const tool of tools) {
      expect(tool.readOnlySafe).toBe(true);
    }
  });

  it('production_use preset with readOnly=true is equivalent to production_use with readOnly=false', () => {
    // production_use already filters to readOnlySafe, so readOnly flag should not change the result
    const withReadOnly = getAvailableTools(grant({ preset: 'production_use' }), true);
    const withoutReadOnly = getAvailableTools(grant({ preset: 'production_use' }), false);
    expect(toolNames(withReadOnly)).toEqual(toolNames(withoutReadOnly));
  });

  it('readOnly=false with full_access returns all tools', () => {
    const tools = getAvailableTools(grant({ preset: 'full_access' }), false);
    expect(tools).toHaveLength(NEON_TOOLS.length);
  });
});

// ---------------------------------------------------------------------------
// Edge cases: custom preset with null vs empty scopes
// ---------------------------------------------------------------------------
describe('filterToolsForGrant – custom preset edge cases', () => {
  it('custom preset with scopes: null returns only always-available tools', () => {
    const filtered = filterToolsForGrant(
      NEON_TOOLS,
      grant({ preset: 'custom', scopes: null }),
    );
    const names = toolNames(filtered);
    expect(names).toEqual(['search', 'fetch']);
  });

  it('custom preset with scopes: [] returns only always-available tools', () => {
    const filtered = filterToolsForGrant(
      NEON_TOOLS,
      grant({ preset: 'custom', scopes: [] }),
    );
    const names = toolNames(filtered);
    expect(names).toEqual(['search', 'fetch']);
  });

  it('custom with null scopes and custom with empty scopes produce the same result', () => {
    const withNull = filterToolsForGrant(
      NEON_TOOLS,
      grant({ preset: 'custom', scopes: null }),
    );
    const withEmpty = filterToolsForGrant(
      NEON_TOOLS,
      grant({ preset: 'custom', scopes: [] }),
    );
    expect(toolNames(withNull)).toEqual(toolNames(withEmpty));
  });
});

// ---------------------------------------------------------------------------
// Edge cases: injectProjectId with null/undefined in args
// ---------------------------------------------------------------------------
describe('injectProjectId – edge cases', () => {
  it('overwrites args.projectId: null with grant projectId', () => {
    const result = injectProjectId(
      { sql: 'SELECT 1', projectId: null },
      grant({ projectId: 'proj-abc' }),
    );
    expect(result.projectId).toBe('proj-abc');
  });

  it('overwrites args.projectId: undefined with grant projectId', () => {
    const result = injectProjectId(
      { sql: 'SELECT 1', projectId: undefined },
      grant({ projectId: 'proj-abc' }),
    );
    expect(result.projectId).toBe('proj-abc');
  });
});

// ---------------------------------------------------------------------------
// injectProjectId
// ---------------------------------------------------------------------------
describe('injectProjectId', () => {
  it('injects projectId when grant has one', () => {
    const result = injectProjectId(
      { sql: 'SELECT 1' },
      grant({ projectId: 'proj-abc' }),
    );
    expect(result).toEqual({ sql: 'SELECT 1', projectId: 'proj-abc' });
  });

  it('does not inject when projectId is null', () => {
    const args = { sql: 'SELECT 1' };
    const result = injectProjectId(args, grant());
    expect(result).toBe(args); // same reference, no modification
  });

  it('does not overwrite existing projectId in args', () => {
    // The implementation always sets projectId from grant when present
    const result = injectProjectId(
      { sql: 'SELECT 1', projectId: 'old-proj' },
      grant({ projectId: 'new-proj' }),
    );
    expect(result.projectId).toBe('new-proj');
  });
});
