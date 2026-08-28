/**
 * Tests for tool definitions integrity.
 *
 * Validates the NEON_TOOLS array and NEON_HANDLERS mapping
 * to catch missing handlers, incorrect annotations, or
 * accidental tool count regressions.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod/v3';
import { publishedId } from '@neon/tools';
import { HOST_TOOLS, NEON_TOOLS } from '../tools/definitions';
import { generatedToolPathHas } from '../tools/generated/adapt';
import { PINNED_MCP_NAMES, TOOL_NAMES } from '../tools/generated/names';
import { GENERATED_TOOL_IDS } from '../tools/generated/operations';
import { NEON_HANDLERS } from '../tools/tools';
import { SCOPE_CATEGORIES } from '../utils/grant-context';

const HOST_READ_ONLY_TOOLS = [
  'describe_branch',
  'describe_table_schema',
  'explain_sql_statement',
  'fetch',
  'get_database_tables',
  'get_doc_resource',
  'get_neon_auth_config',
  'inspect_database',
  'list_docs_resources',
  'list_organizations',
  'list_slow_queries',
  'run_sql',
  'run_sql_transaction',
  'search',
];

const SECRET_GENERATED_TOOLS = [
  'postgres_connection_string',
  'postgres_roles_password',
];

const OMITTED_ACCESS_CONTROL_WRITES = [
  'projects_permissions_grant',
  'projects_permissions_revoke',
  'projects_members_set_role',
  'projects_members_remove_role',
];

const OMITTED_BLOB_TOOLS = ['storage_objects_get'];

describe('NEON_TOOLS definitions', () => {
  it('every tool has a name, scope (or null), kind, projectScoped, and readOnlySafe flag', () => {
    for (const tool of NEON_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(
        tool.scope === null || SCOPE_CATEGORIES.includes(tool.scope),
        `${tool.name} has invalid scope: ${String(tool.scope)}`,
      ).toBe(true);
      expect(tool.kind === 'host' || tool.kind === 'generated').toBe(true);
      expect(typeof tool.projectScoped).toBe('boolean');
      expect(typeof tool.readOnlySafe).toBe('boolean');
    }
  });

  it('every scope category is used by at least one tool', () => {
    const usedScopes = new Set(
      NEON_TOOLS.map((tool) => tool.scope).filter(
        (scope): scope is (typeof SCOPE_CATEGORIES)[number] => scope !== null,
      ),
    );

    for (const scope of SCOPE_CATEGORIES) {
      expect(
        usedScopes.has(scope),
        `No tool is assigned to scope category "${scope}"`,
      ).toBe(true);
    }
  });

  it('every tool has MCP annotations', () => {
    for (const tool of NEON_TOOLS) {
      expect(tool.annotations).toBeDefined();
      expect(tool.annotations.title).toBeTruthy();
      expect(typeof tool.annotations.readOnlyHint).toBe('boolean');
      expect(typeof tool.annotations.destructiveHint).toBe('boolean');
      expect(typeof tool.annotations.idempotentHint).toBe('boolean');
      expect(typeof tool.annotations.openWorldHint).toBe('boolean');
    }
  });

  it('every tool has a corresponding handler in NEON_HANDLERS', () => {
    for (const tool of NEON_TOOLS) {
      expect(
        NEON_HANDLERS[tool.name],
        `Missing handler for tool "${tool.name}"`,
      ).toBeDefined();
      expect(typeof NEON_HANDLERS[tool.name]).toBe('function');
    }
  });

  it('has no duplicate tool names', () => {
    const names = NEON_TOOLS.map((t) => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('has no duplicate annotation titles', () => {
    const titles = NEON_TOOLS.map((t) => t.annotations.title);
    const unique = new Set(titles);
    expect(unique.size).toBe(titles.length);
  });
});

describe('docs tools definitions', () => {
  const listDocsTool = NEON_TOOLS.find((t) => t.name === 'list_docs_resources');
  const getDocTool = NEON_TOOLS.find((t) => t.name === 'get_doc_resource');

  it('list_docs_resources exists', () => {
    expect(listDocsTool).toBeDefined();
  });

  it('get_doc_resource exists', () => {
    expect(getDocTool).toBeDefined();
  });

  it('list_docs_resources is read-only safe', () => {
    expect(listDocsTool!.readOnlySafe).toBe(true);
  });

  it('get_doc_resource is read-only safe', () => {
    expect(getDocTool!.readOnlySafe).toBe(true);
  });

  it('list_docs_resources has openWorldHint: true (fetches external URL)', () => {
    expect(listDocsTool!.annotations.openWorldHint).toBe(true);
  });

  it('get_doc_resource has openWorldHint: true (fetches external URL)', () => {
    expect(getDocTool!.annotations.openWorldHint).toBe(true);
  });

  it('list_docs_resources is non-destructive and idempotent', () => {
    expect(listDocsTool!.annotations.destructiveHint).toBe(false);
    expect(listDocsTool!.annotations.idempotentHint).toBe(true);
  });

  it('get_doc_resource is non-destructive and idempotent', () => {
    expect(getDocTool!.annotations.destructiveHint).toBe(false);
    expect(getDocTool!.annotations.idempotentHint).toBe(true);
  });
});

describe('read-only tool surface', () => {
  it('keeps the host read-only allowlist', () => {
    const hostReadOnlyNames = HOST_TOOLS.filter((t) => t.readOnlySafe).map(
      (t) => t.name,
    );

    expect([...hostReadOnlyNames].sort()).toEqual(
      [...HOST_READ_ONLY_TOOLS].sort(),
    );
  });

  it('withholds get_connection_string, which returns a privileged password', () => {
    const tool = NEON_TOOLS.find((t) => t.name === 'get_connection_string');

    expect(tool!.readOnlySafe).toBe(false);
  });

  it('treats query_logs as read-only despite POST', () => {
    const tool = NEON_TOOLS.find((t) => t.name === 'query_logs');
    expect(tool).toBeDefined();
    expect(tool!.readOnlySafe).toBe(true);
    expect(tool!.annotations.readOnlyHint).toBe(true);
    expect(tool!.annotations.destructiveHint).toBe(false);
  });

  it('publishes every tool argument in snake_case', () => {
    for (const tool of NEON_TOOLS) {
      for (const key of Object.keys(toolShape(tool))) {
        expect(key, `${tool.name}.${key}`).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    }
  });

  it('rejects camelCase aliases on host tool schemas', () => {
    const runSql = HOST_TOOLS.find((tool) => tool.name === 'run_sql');
    expect(runSql).toBeDefined();
    if (!(runSql?.inputSchema instanceof z.ZodObject)) {
      throw new Error('run_sql must keep a Zod 3 object schema');
    }
    expect(
      runSql.inputSchema.safeParse({
        sql: 'select 1',
        project_id: 'proj-1',
      }).success,
    ).toBe(true);
    expect(
      runSql.inputSchema.safeParse({
        sql: 'select 1',
        projectId: 'proj-1',
      }).success,
    ).toBe(false);
    expect(
      runSql.inputSchema.safeParse({
        sql: 'select 1',
        project_id: 'proj-1',
        projectId: 'proj-1',
      }).success,
    ).toBe(false);
  });

  it('rejects camelCase aliases on generated tool schemas', () => {
    const describeProject = NEON_TOOLS.find(
      (tool) => tool.name === 'describe_project',
    );
    expect(describeProject).toBeDefined();
    const schema = describeProject?.inputSchema;
    if (
      typeof schema !== 'object' ||
      schema === null ||
      !('safeParse' in schema) ||
      typeof schema.safeParse !== 'function'
    ) {
      throw new Error('describe_project must keep a parseable schema');
    }
    expect(
      schema.safeParse({
        project_id: 'proj-1',
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        projectId: 'proj-1',
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        project_id: 'proj-1',
        projectId: 'proj-1',
      }).success,
    ).toBe(false);
  });

  it('does not expose secret-returning generated tools', () => {
    const names = new Set(NEON_TOOLS.map((t) => t.name));
    for (const name of SECRET_GENERATED_TOOLS) {
      expect(names.has(name), name).toBe(false);
    }
  });

  it('does not expose project member or permission writes', () => {
    const names = new Set(NEON_TOOLS.map((t) => t.name));
    for (const name of OMITTED_ACCESS_CONTROL_WRITES) {
      expect(names.has(name), name).toBe(false);
    }
  });

  it('does not expose the raw bucket-object GET', () => {
    const names = new Set(NEON_TOOLS.map((t) => t.name));
    for (const name of OMITTED_BLOB_TOOLS) {
      expect(names.has(name), name).toBe(false);
    }
  });

  it('assigns every generated tool a scope category', () => {
    for (const tool of NEON_TOOLS.filter(
      (candidate) => candidate.kind === 'generated',
    )) {
      expect(tool.scope, tool.name).not.toBeNull();
    }
  });
});

function generatedShape(
  tool: (typeof NEON_TOOLS)[number],
): Record<string, unknown> {
  return toolShape(tool);
}

function toolShape(tool: (typeof NEON_TOOLS)[number]): Record<string, unknown> {
  const schema = tool.inputSchema;
  if (
    typeof schema !== 'object' ||
    schema === null ||
    !('shape' in schema) ||
    typeof schema.shape !== 'object' ||
    schema.shape === null
  ) {
    return {};
  }
  return schema.shape as Record<string, unknown>;
}

describe('generated tool interface', () => {
  it('pins every generated MCP name', () => {
    expect(Object.keys(PINNED_MCP_NAMES).sort()).toEqual(
      [...GENERATED_TOOL_IDS].sort(),
    );
    expect(PINNED_MCP_NAMES['projects.list']).toBe('list_projects');
    expect(PINNED_MCP_NAMES['projects.get']).toBe('describe_project');
    expect(PINNED_MCP_NAMES['projects.create']).toBe('create_project');
    expect(PINNED_MCP_NAMES['projects.delete']).toBe('delete_project');
    expect(PINNED_MCP_NAMES['branches.create']).toBe('create_branch');
    expect(PINNED_MCP_NAMES['branches.resetFromParent']).toBe(
      'reset_from_parent',
    );
    expect(PINNED_MCP_NAMES['branches.compareSchema']).toBe(
      'compare_database_schema',
    );
    expect(PINNED_MCP_NAMES['branches.delete']).toBe('delete_branch');
    expect(PINNED_MCP_NAMES['postgres.endpoints.listByBranch']).toBe(
      'list_branch_computes',
    );
    expect(PINNED_MCP_NAMES['auth.create']).toBe('provision_neon_auth');
    expect(PINNED_MCP_NAMES['postgres.dataApi.create']).toBe(
      'provision_neon_data_api',
    );
    expect(PINNED_MCP_NAMES['logs.query']).toBe('query_logs');
    expect(PINNED_MCP_NAMES['logs.fields']).toBe('list_log_fields');
    expect(PINNED_MCP_NAMES['logs.fieldValues']).toBe('list_log_field_values');
  });

  it('overrides only names that differ from @neon/tools', () => {
    for (const id of GENERATED_TOOL_IDS) {
      const pinned = PINNED_MCP_NAMES[id];
      if (publishedId(id) === pinned) {
        expect(TOOL_NAMES).not.toHaveProperty(id);
      } else {
        expect(TOOL_NAMES[id]).toBe(pinned);
      }
    }
  });

  it('does not tell the agent to pass a cursor on query_logs', () => {
    const tool = NEON_TOOLS.find((t) => t.name === 'query_logs');
    expect(tool).toBeDefined();
    expect(generatedShape(tool!)).not.toHaveProperty('cursor');
    expect(tool!.description).toContain('There is no `cursor` argument');
    expect(tool!.description).not.toMatch(/add the `cursor` value/i);
    expect(tool!.description).not.toMatch(/pass the returned `next_cursor`/i);
  });

  it('keeps query_logs filter and time-window constraints', () => {
    const tool = NEON_TOOLS.find((t) => t.name === 'query_logs');
    expect(tool!.description).toContain('logql');
    expect(tool!.description).toContain('since');
    expect(tool!.description).toContain('start_time');
    expect(tool!.description).toContain('not both');
  });

  it('keeps list_log_field_values window and field-discovery constraints', () => {
    const tool = NEON_TOOLS.find((t) => t.name === 'list_log_field_values');
    expect(tool!.description).toContain('list_log_fields');
    expect(tool!.description).toContain('unknown_field');
    expect(tool!.description).toContain('six hours');
    expect(tool!.description).not.toContain('previous hour');
  });

  it('keeps deploy_function zip and at-least-one-field constraints', () => {
    const tool = NEON_TOOLS.find((t) => t.name === 'deploy_function');
    expect(tool!.description).toContain('zip');
    expect(tool!.description).toContain('at least one');
    expect(tool!.description).toContain('first deployment');
  });

  it('does not tell the agent to pass a cursor on list_operations', () => {
    const tool = NEON_TOOLS.find((t) => t.name === 'list_operations');
    expect(tool).toBeDefined();
    expect(generatedShape(tool!)).not.toHaveProperty('cursor');
    expect(tool!.description).toContain('There is no `cursor` argument');
    expect(tool!.description).not.toMatch(/add the `cursor` value/i);
  });

  it('says list_projects walks every page and has no cursor argument', () => {
    const tool = NEON_TOOLS.find((t) => t.name === 'list_projects');
    expect(tool!.description).toContain('Returns every page');
    expect(tool!.description).toContain('There is no `cursor` argument');
    expect(tool!.description).toContain('org_id');
    expect(generatedShape(tool!)).not.toHaveProperty('cursor');
  });

  it('says describe_project returns the project record only', () => {
    const tool = NEON_TOOLS.find((t) => t.name === 'describe_project');
    expect(tool!.description).toContain('Call `list_branches` for branches');
  });

  it('names restore_snapshot on finalize_branch_restore', () => {
    const restore = NEON_TOOLS.find((t) => t.name === 'restore_snapshot');
    expect(generatedShape(restore!)).toHaveProperty('finalize');
    expect(generatedShape(restore!)).not.toHaveProperty('finalize_restore');

    const tool = NEON_TOOLS.find((t) => t.name === 'finalize_branch_restore');
    expect(tool!.description).toContain('restore_snapshot');
    expect(tool!.description).toContain('finalize: false');
    expect(tool!.description).toContain('restarts');
    expect(tool!.description).not.toContain('restoreSnapshot');
    expect(tool!.description).not.toContain('finalize_restore');
  });

  it('exposes flat arguments on the project list, create, and delete tools', () => {
    const listProjects = NEON_TOOLS.find(
      (tool) => tool.name === 'list_projects',
    );
    const createProject = NEON_TOOLS.find(
      (tool) => tool.name === 'create_project',
    );
    const deleteProject = NEON_TOOLS.find(
      (tool) => tool.name === 'delete_project',
    );

    expect(generatedShape(listProjects!)).toHaveProperty('limit');
    expect(generatedShape(createProject!)).toHaveProperty('name');
    expect(generatedShape(createProject!)).toHaveProperty('org_id');
    expect(generatedShape(createProject!)).not.toHaveProperty('pooled');
    expect(createProject?.description).toContain('get_connection_string');
    expect(createProject?.description).not.toContain(
      'returns a connection string',
    );
    expect(generatedShape(deleteProject!)).toHaveProperty('project_id');
    expect(generatedShape(listProjects!)).not.toHaveProperty('query');
    expect(generatedShape(createProject!)).not.toHaveProperty('body');
    expect(generatedShape(deleteProject!)).not.toHaveProperty('path');
  });

  it('marks additive creates as non-destructive and deletes as destructive', () => {
    const createProject = NEON_TOOLS.find(
      (tool) => tool.name === 'create_project',
    );
    const createBranch = NEON_TOOLS.find(
      (tool) => tool.name === 'create_branch',
    );
    const deleteProject = NEON_TOOLS.find(
      (tool) => tool.name === 'delete_project',
    );
    expect(createProject?.annotations.destructiveHint).toBe(false);
    expect(createBranch?.annotations.destructiveHint).toBe(false);
    expect(deleteProject?.annotations.destructiveHint).toBe(true);
    expect(
      NEON_TOOLS.find((tool) => tool.name === 'finalize_branch_restore')
        ?.annotations.destructiveHint,
    ).toBe(true);
    expect(
      NEON_TOOLS.find((tool) => tool.name === 'set_default_branch')?.annotations
        .destructiveHint,
    ).toBe(true);
  });

  it('describes create_branch as a compute workflow without a connection string', () => {
    const createBranch = NEON_TOOLS.find(
      (tool) => tool.name === 'create_branch',
    );
    const shape = generatedShape(createBranch!);
    expect(shape).toHaveProperty('project_id');
    expect(shape).toHaveProperty('name');
    expect(shape).toHaveProperty('no_compute');
    expect(shape).not.toHaveProperty('pooled');
    expect(shape).not.toHaveProperty('branch');
    expect(shape).not.toHaveProperty('endpoints');
    expect(createBranch?.description).toContain('get_connection_string');
    expect(createBranch?.description).toContain('restore_snapshot');
    expect(createBranch?.description).not.toContain(
      'returns a connection string',
    );
  });

  it('pins reset_from_parent and compare_database_schema', () => {
    const reset = NEON_TOOLS.find((tool) => tool.name === 'reset_from_parent');
    expect(reset?.scope).toBe('branches');
    expect(reset?.readOnlySafe).toBe(false);
    expect(reset?.annotations.destructiveHint).toBe(true);
    expect(reset?.description).toContain('NEVER run autonomously');
    expect(reset?.description).toContain(
      'those children move to the new branch',
    );
    expect(reset?.description).toContain(
      'Discards every change the branch has written since it diverged',
    );
    expect(reset?.description).toContain('restore_snapshot');
    expect(generatedShape(reset!)).toHaveProperty('preserve_under_name');
    expect(generatedShape(reset!)).not.toHaveProperty('preserveUnderName');
    expect(
      reset?.inputSchema.safeParse({
        project_id: 'proj',
        branch_id: 'br-1',
      }).success,
    ).toBe(true);
    expect(
      reset?.inputSchema.safeParse({
        project_id: 'proj',
        branch_id: 'br-1',
        preserveUnderName: 'old',
      }).success,
    ).toBe(false);

    const compare = NEON_TOOLS.find(
      (tool) => tool.name === 'compare_database_schema',
    );
    expect(compare?.scope).toBe('schema');
    expect(compare?.readOnlySafe).toBe(true);
    expect(compare?.annotations.readOnlyHint).toBe(true);
    expect(generatedShape(compare!)).toHaveProperty('database_name');
    expect(generatedShape(compare!)).toHaveProperty('base_branch_id');
    expect(generatedShape(compare!)).toHaveProperty('lsn');
    expect(generatedShape(compare!)).not.toHaveProperty('db_name');
    expect(compare?.description).not.toContain('run_sql');
    expect(compare?.description).toContain('base_branch_id');
    expect(compare?.description).toContain('parent');
    expect(compare?.description).toContain('point-in-time');
    expect(
      compare?.inputSchema.safeParse({
        project_id: 'proj',
        branch_id: 'br-1',
        database_name: 'neondb',
      }).success,
    ).toBe(true);
    expect(
      compare?.inputSchema.safeParse({
        project_id: 'proj',
        branch_id: 'br-1',
        db_name: 'neondb',
      }).success,
    ).toBe(false);
  });

  it('keeps the never-run-autonomously text on delete_branch and delete_project', () => {
    const deleteBranch = NEON_TOOLS.find(
      (tool) => tool.name === 'delete_branch',
    );
    const deleteProject = NEON_TOOLS.find(
      (tool) => tool.name === 'delete_project',
    );
    expect(deleteBranch?.description).toContain('NEVER run autonomously');
    expect(deleteBranch?.description).toContain('delete_project');
    expect(deleteProject?.description).toContain('NEVER run autonomously');
    expect(deleteProject?.description).toContain('delete_branch');
  });

  it('keeps host workflow constraints in the short descriptions', () => {
    const prepareMigration = NEON_TOOLS.find(
      (tool) => tool.name === 'prepare_database_migration',
    );
    const completeMigration = NEON_TOOLS.find(
      (tool) => tool.name === 'complete_database_migration',
    );
    const prepareTuning = NEON_TOOLS.find(
      (tool) => tool.name === 'prepare_query_tuning',
    );
    const completeTuning = NEON_TOOLS.find(
      (tool) => tool.name === 'complete_query_tuning',
    );
    const authConfig = NEON_TOOLS.find(
      (tool) => tool.name === 'get_neon_auth_config',
    );
    const inspect = NEON_TOOLS.find((tool) => tool.name === 'inspect_database');
    const runSql = NEON_TOOLS.find((tool) => tool.name === 'run_sql');

    expect(prepareMigration?.description).toContain(
      'complete_database_migration',
    );
    expect(completeMigration?.description).toContain(
      'prepare_database_migration',
    );
    expect(completeMigration?.description).toContain(
      'Set apply_changes false to discard',
    );
    expect(completeMigration?.description).not.toContain(
      'apply_changes from prepare_database_migration',
    );
    expect(prepareTuning?.description).toContain('tuning_id');
    expect(prepareTuning?.description).toContain('explain_sql_statement');
    expect(prepareTuning?.description).toContain('apply_changes true');
    expect(prepareTuning?.description).toContain('prepare_database_migration');
    expect(completeTuning?.description).toContain('even when the user rejects');
    expect(completeTuning?.description).toContain('explain_sql_statement');
    expect(completeTuning?.description).toContain(
      'Set apply_changes true to apply',
    );
    expect(authConfig?.description).toContain('redacted');
    expect(runSql?.description).toContain('temporary branch');
    expect(inspect?.description).toContain('CREATE EXTENSION');
    expect(inspect?.description).toContain('ask before');
  });

  it('notes branch id on generated tools that take a path branch_id', () => {
    const note = 'branch_id is a branch id (br-...), not a branch name';
    for (const tool of NEON_TOOLS.filter(
      (candidate) => candidate.kind === 'generated',
    )) {
      if (generatedToolPathHas(tool.name, 'branch_id')) {
        expect(tool.description, tool.name).toContain(note);
      } else {
        expect(tool.description, tool.name).not.toContain(note);
      }
    }
  });
});
