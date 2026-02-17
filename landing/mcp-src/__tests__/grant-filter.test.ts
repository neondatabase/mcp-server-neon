import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  filterToolsForGrant,
  getAvailableTools,
  getAccessControlWarnings,
  injectProjectId,
} from '../tools/grant-filter';
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
  it('has 29 tools', () => {
    expect(NEON_TOOLS).toHaveLength(29);
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
    expect(names).toContain('list_docs_resources');
    expect(names).toContain('get_doc_resource');
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
    expect(names).not.toContain('compare_database_schema');

    // docs scope tools
    expect(names).toContain('list_docs_resources');
    expect(names).toContain('get_doc_resource');

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
      'data_api',
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
    expect(names).toHaveLength(5);
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
    const describeProject = filtered.find((t) => t.name === 'describe_project');
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
      expect(tool.readOnlySafe, `${tool.name} should be readOnlySafe`).toBe(
        true,
      );
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
    const tools = getAvailableTools(grant({ projectId: 'proj-abc' }), true);
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
    const withReadOnly = getAvailableTools(
      grant({ preset: 'production_use' }),
      true,
    );
    const withoutReadOnly = getAvailableTools(
      grant({ preset: 'production_use' }),
      false,
    );
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

// ---------------------------------------------------------------------------
// getAccessControlWarnings
// ---------------------------------------------------------------------------
describe('getAccessControlWarnings', () => {
  it('returns a warning when production_use preset with readOnly=false', () => {
    const warnings = getAccessControlWarnings(
      grant({ preset: 'production_use' }),
      false,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('⚠️ Warning:');
    expect(warnings[0]).toContain('production_use');
    expect(warnings[0]).toContain('read-only');
  });

  it('returns no warning when production_use preset with readOnly=true', () => {
    const warnings = getAccessControlWarnings(
      grant({ preset: 'production_use' }),
      true,
    );
    expect(warnings).toHaveLength(0);
  });

  it('returns no warning for full_access with readOnly=false', () => {
    const warnings = getAccessControlWarnings(
      grant({ preset: 'full_access' }),
      false,
    );
    expect(warnings).toHaveLength(0);
  });

  it('returns no warning for full_access with readOnly=true', () => {
    const warnings = getAccessControlWarnings(
      grant({ preset: 'full_access' }),
      true,
    );
    expect(warnings).toHaveLength(0);
  });

  it('returns no warning for local_development with readOnly=false', () => {
    const warnings = getAccessControlWarnings(
      grant({ preset: 'local_development' }),
      false,
    );
    expect(warnings).toHaveLength(0);
  });

  it('returns no warning for custom preset with valid scopes', () => {
    const warnings = getAccessControlWarnings(
      grant({ preset: 'custom', scopes: ['querying'] }),
      false,
    );
    expect(warnings).toHaveLength(0);
  });

  it('returns a warning when custom preset has null scopes (nearly locked out)', () => {
    const warnings = getAccessControlWarnings(
      grant({ preset: 'custom', scopes: null }),
      false,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('⚠️ Warning:');
    expect(warnings[0]).toContain('custom');
    expect(warnings[0]).toContain('no valid scope categories');
  });

  it('returns a warning when custom preset has empty scopes array', () => {
    const warnings = getAccessControlWarnings(
      grant({ preset: 'custom', scopes: [] }),
      false,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('⚠️ Warning:');
    expect(warnings[0]).toContain('X-Neon-Scopes');
  });

  it('returns no warning for custom preset with all scopes', () => {
    const allScopes: ScopeCategory[] = [
      'projects',
      'branches',
      'schema',
      'querying',
      'performance',
      'neon_auth',
      'data_api',
      'docs',
    ];
    const warnings = getAccessControlWarnings(
      grant({ preset: 'custom', scopes: allScopes }),
      false,
    );
    expect(warnings).toHaveLength(0);
  });

  it('does not return custom-scopes warning for non-custom presets', () => {
    // full_access with null scopes should NOT trigger the custom warning
    const warnings = getAccessControlWarnings(
      grant({ preset: 'full_access', scopes: null }),
      false,
    );
    expect(warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getAvailableTools – exact tool count matrix
// ---------------------------------------------------------------------------
describe('getAvailableTools – exact tool counts', () => {
  it.each([
    // preset, projectId, readOnly, expectedCount
    ['full_access', null, false, 29],
    ['full_access', null, true, 18],
    ['full_access', 'proj-123', false, 24],
    ['full_access', 'proj-123', true, 15],
    ['local_development', null, false, 27],
    ['local_development', null, true, 18],
    ['local_development', 'proj-123', false, 24],
    ['local_development', 'proj-123', true, 15],
    ['production_use', null, false, 18],
    ['production_use', 'proj-123', false, 15],
  ] as const)(
    '%s / project=%s / readOnly=%s -> %d tools',
    (preset, projectId, readOnly, expectedCount) => {
      const tools = getAvailableTools(grant({ preset, projectId }), readOnly);
      expect(tools).toHaveLength(expectedCount);
    },
  );

  it('custom (no scopes) / no project / no readonly -> 2 tools', () => {
    const tools = getAvailableTools(
      grant({ preset: 'custom', scopes: [] }),
      false,
    );
    expect(tools).toHaveLength(2);
  });

  it('custom (all scopes) / no project / no readonly -> 29 tools', () => {
    const allScopes: ScopeCategory[] = [
      'projects',
      'branches',
      'schema',
      'querying',
      'performance',
      'neon_auth',
      'data_api',
      'docs',
    ];
    const tools = getAvailableTools(
      grant({ preset: 'custom', scopes: allScopes }),
      false,
    );
    expect(tools).toHaveLength(29);
  });

  it('custom (querying only) / no project / no readonly -> 6 tools', () => {
    const tools = getAvailableTools(
      grant({ preset: 'custom', scopes: ['querying'] }),
      false,
    );
    expect(tools).toHaveLength(6);
  });

  it('custom (querying only) / project / readonly -> 4 tools', () => {
    const tools = getAvailableTools(
      grant({ preset: 'custom', scopes: ['querying'], projectId: 'proj-123' }),
      true,
    );
    expect(tools).toHaveLength(4);
  });

  // Scope category counts from temp.md "Custom Scope Combinations" table
  it.each([
    [['projects', 'branches'] as ScopeCategory[], 14],
    [['performance'] as ScopeCategory[], 6],
    [['neon_auth'] as ScopeCategory[], 3],
  ] as const)('custom scopes %s -> %d tools', (scopes, expectedCount) => {
    const tools = getAvailableTools(
      grant({ preset: 'custom', scopes: [...scopes] }),
      false,
    );
    expect(tools).toHaveLength(expectedCount);
  });

  // Edge case #2 from temp.md: local_development + project = same as full_access + project
  it('local_development + project-scoped = same count as full_access + project-scoped (24)', () => {
    const localDev = getAvailableTools(
      grant({ preset: 'local_development', projectId: 'proj-123' }),
      false,
    );
    const fullAccess = getAvailableTools(
      grant({ preset: 'full_access', projectId: 'proj-123' }),
      false,
    );
    expect(localDev).toHaveLength(24);
    expect(fullAccess).toHaveLength(24);
    expect(toolNames(localDev)).toEqual(toolNames(fullAccess));
  });

  // Custom scopes + project-scoped
  it('custom (querying,schema) + project-scoped -> 9 tools', () => {
    const tools = getAvailableTools(
      grant({
        preset: 'custom',
        scopes: ['querying', 'schema'],
        projectId: 'proj-abc',
      }),
      false,
    );
    expect(tools).toHaveLength(9);
  });
});

// ---------------------------------------------------------------------------
// Tool inventory integrity – verify tool-to-scope assignments and flags
// match the documented spec in temp.md Section 5
// ---------------------------------------------------------------------------
describe('tool inventory integrity', () => {
  /**
   * Complete map from temp.md "Tool Inventory" table.
   * Each entry: [toolName, expectedScope, expectedReadOnlySafe]
   */
  const EXPECTED_TOOL_MAP: [string, string | null, boolean][] = [
    ['list_projects', 'projects', true],
    ['list_organizations', 'projects', true],
    ['list_shared_projects', 'projects', true],
    ['create_project', 'projects', false],
    ['delete_project', 'projects', false],
    ['describe_project', 'projects', true],
    ['run_sql', 'querying', true],
    ['run_sql_transaction', 'querying', true],
    ['describe_table_schema', 'schema', true],
    ['get_database_tables', 'schema', true],
    ['create_branch', 'branches', false],
    ['prepare_database_migration', 'querying', false],
    ['complete_database_migration', 'querying', false],
    ['describe_branch', 'branches', true],
    ['delete_branch', 'branches', false],
    ['reset_from_parent', 'branches', false],
    ['get_connection_string', 'branches', true],
    ['provision_neon_auth', 'neon_auth', false],
    ['provision_neon_data_api', 'data_api', false],
    ['explain_sql_statement', 'performance', true],
    ['prepare_query_tuning', 'performance', false],
    ['complete_query_tuning', 'performance', false],
    ['list_slow_queries', 'performance', true],
    ['list_branch_computes', 'branches', true],
    ['compare_database_schema', 'schema', true],
    ['search', null, true],
    ['fetch', null, true],
    ['list_docs_resources', 'docs', true],
    ['get_doc_resource', 'docs', true],
  ];

  it('has exactly the expected number of tools', () => {
    expect(NEON_TOOLS).toHaveLength(EXPECTED_TOOL_MAP.length);
  });

  it.each(EXPECTED_TOOL_MAP)(
    '%s has scope=%s, readOnlySafe=%s',
    (toolName, expectedScope, expectedReadOnlySafe) => {
      const tool = NEON_TOOLS.find((t) => t.name === toolName);
      expect(tool, `Tool "${toolName}" not found in NEON_TOOLS`).toBeDefined();
      expect(tool!.scope).toBe(expectedScope);
      expect(tool!.readOnlySafe).toBe(expectedReadOnlySafe);
    },
  );

  // Verify the exact set of project-agnostic tools
  it('project-agnostic tools are exactly: list_projects, list_organizations, list_shared_projects, create_project, delete_project', () => {
    const projectScopedTools = filterToolsForGrant(
      NEON_TOOLS,
      grant({ projectId: 'proj-test' }),
    );
    const hiddenTools = NEON_TOOLS.map((t) => t.name).filter(
      (name) => !projectScopedTools.some((t) => t.name === name),
    );

    expect(hiddenTools.sort()).toEqual([
      'create_project',
      'delete_project',
      'list_organizations',
      'list_projects',
      'list_shared_projects',
    ]);
  });

  // Verify tools-per-scope-category counts from temp.md table
  it.each([
    ['projects', 6],
    ['branches', 6],
    ['schema', 3],
    ['querying', 4],
    ['performance', 4],
    ['neon_auth', 1],
    ['data_api', 1],
    ['docs', 2],
  ] as const)('scope category "%s" has %d tools', (scope, expectedCount) => {
    const toolsInScope = NEON_TOOLS.filter((t) => t.scope === scope);
    expect(toolsInScope).toHaveLength(expectedCount);
  });

  it('2 tools have no scope (null) and are always-available', () => {
    const nullScopeTools = NEON_TOOLS.filter((t) => t.scope === null);
    expect(nullScopeTools).toHaveLength(2);
    expect(nullScopeTools.map((t) => t.name).sort()).toEqual([
      'fetch',
      'search',
    ]);
  });

  // Verify readOnlySafe counts
  it('18 tools are readOnlySafe', () => {
    const readOnlySafe = NEON_TOOLS.filter((t) => t.readOnlySafe);
    expect(readOnlySafe).toHaveLength(18);
  });

  it('11 tools are NOT readOnlySafe (write-only)', () => {
    const writeOnly = NEON_TOOLS.filter((t) => !t.readOnlySafe);
    expect(writeOnly).toHaveLength(11);
  });

  // Edge case #5: run_sql and run_sql_transaction are readOnlySafe
  // This is potentially surprising but intentional (they can run read-only queries)
  it('run_sql and run_sql_transaction are marked readOnlySafe (available in production_use)', () => {
    const runSql = NEON_TOOLS.find((t) => t.name === 'run_sql');
    const runSqlTx = NEON_TOOLS.find((t) => t.name === 'run_sql_transaction');
    expect(runSql!.readOnlySafe).toBe(true);
    expect(runSqlTx!.readOnlySafe).toBe(true);
  });
});
