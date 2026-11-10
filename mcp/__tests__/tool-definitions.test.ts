/**
 * Tests for tool definitions integrity.
 *
 * Validates the NEON_TOOLS array and NEON_HANDLERS mapping
 * to catch missing handlers, incorrect annotations, or
 * accidental tool count regressions.
 */

import { describe, it, expect } from 'vitest';
import { publishedId } from '@neon/tools';
import * as z from 'zod';
import { NEON_TOOLS, PACKAGE_TOOLS } from '../tools/definitions';
import { toListedTool } from '../tools/listed-schema';
import MCP_TOOL_NAMES from '../tools/mcp-tool-names.json';
import { GENERATED_TOOL_SCOPES, TOOL_IDS } from '../tools/operations';
import { NEON_HANDLERS } from '../tools/tools';
import { SCOPE_CATEGORIES } from '../utils/grant-context';

const CUSTOM_TOOLS = NEON_TOOLS.filter((tool) => tool.kind === 'custom');

const CUSTOM_READ_ONLY_TOOLS = [
  'describe_branch',
  'describe_table_schema',
  'explain_sql_statement',
  'fetch',
  'get_database_tables',
  'get_doc',
  'get_neon_auth_config',
  'inspect_database',
  'list_incidents',
  'list_organizations',
  'list_slow_queries',
  'run_sql',
  'search',
  'search_docs',
  'send_feedback',
];

const SECRET_GENERATED_TOOLS = [
  'postgres_connection_string',
  'postgres_roles_password',
  'reveal_credentials',
];

const OMITTED_ACCESS_CONTROL_WRITES = [
  'projects_permissions_grant',
  'projects_permissions_revoke',
  'projects_members_set_role',
  'projects_members_remove_role',
];

const OMITTED_BLOB_TOOLS = ['storage_objects_get'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

describe('NEON_TOOLS definitions', () => {
  it('every tool has a name, scope (or null), kind, projectScoped, and readOnlySafe flag', () => {
    for (const tool of NEON_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(
        tool.scope === null || SCOPE_CATEGORIES.includes(tool.scope),
        `${tool.name} has invalid scope: ${String(tool.scope)}`,
      ).toBe(true);
      expect(tool.kind === 'custom' || tool.kind === 'generated').toBe(true);
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

  it('marks private Neon operations closed-world and public-capable ones open-world', () => {
    expect(NEON_TOOLS).toHaveLength(141);
    const generated = NEON_TOOLS.filter((tool) => tool.kind === 'generated');
    expect(generated).toHaveLength(120);
    expect(
      NEON_TOOLS.filter((tool) => tool.annotations.openWorldHint)
        .map((tool) => tool.name)
        .sort(),
    ).toEqual([
      'create_storage_bucket',
      'get_doc',
      'list_incidents',
      'search_docs',
      'send_auth_test_email',
      'send_feedback',
    ]);
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
  it.each(['search_docs', 'get_doc'])(
    '%s is a read-only, open-world docs tool available to project-scoped grants',
    (name) => {
      expect(NEON_TOOLS.find((t) => t.name === name)).toMatchObject({
        scope: 'docs',
        readOnlySafe: true,
        projectScoped: true,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      });
    },
  );

  it('no longer defines list_docs_resources or get_doc_resource', () => {
    const names = NEON_TOOLS.map((t) => t.name);
    expect(names).not.toContain('list_docs_resources');
    expect(names).not.toContain('get_doc_resource');
  });
});

describe('read-only tool surface', () => {
  it('keeps the read-only allowlist of the custom tools', () => {
    const customReadOnlyNames = CUSTOM_TOOLS.filter((t) => t.readOnlySafe).map(
      (t) => t.name,
    );

    expect([...customReadOnlyNames].sort()).toEqual(
      [...CUSTOM_READ_ONLY_TOOLS].sort(),
    );
  });

  it('withholds get_connection_string, which returns a privileged password', () => {
    const tool = NEON_TOOLS.find((t) => t.name === 'get_connection_string');

    expect(tool!.readOnlySafe).toBe(false);
  });

  it('withholds run_sql_transaction, whose statements can end the read-only transaction', () => {
    const tool = NEON_TOOLS.find((t) => t.name === 'run_sql_transaction');

    expect(tool!.readOnlySafe).toBe(false);
  });

  it('treats query_logs as read-only despite POST', () => {
    const tool = NEON_TOOLS.find((t) => t.name === 'query_logs');
    expect(tool).toBeDefined();
    expect(tool!.readOnlySafe).toBe(true);
    expect(tool!.annotations.readOnlyHint).toBe(true);
    expect(tool!.annotations.destructiveHint).toBe(false);
  });

  it('marks explain_sql_statement as potentially side-effecting', () => {
    const tool = NEON_TOOLS.find(
      (candidate) => candidate.name === 'explain_sql_statement',
    );

    expect(tool).toBeDefined();
    expect(tool!.readOnlySafe).toBe(true);
    expect(tool!.annotations.readOnlyHint).toBe(false);
    expect(tool!.annotations.destructiveHint).toBe(true);
    expect(tool!.annotations.idempotentHint).toBe(false);
    expect(
      tool!.inputSchema.parse({
        sql: 'select 1',
        project_id: 'proj-1',
      }),
    ).toMatchObject({ analyze: false });
  });

  it('publishes every tool argument in snake_case', () => {
    for (const tool of NEON_TOOLS) {
      for (const key of Object.keys(toolShape(tool))) {
        expect(key, `${tool.name}.${key}`).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    }
  });

  it('describes every published top-level tool input', () => {
    const undocumented: string[] = [];
    let checked = 0;
    for (const tool of NEON_TOOLS) {
      const schema: Record<string, unknown> = toListedTool(tool).inputSchema;
      const properties = isRecord(schema.properties) ? schema.properties : {};
      for (const [key, property] of Object.entries(properties)) {
        checked += 1;
        const description = isRecord(property) ? property.description : null;
        if (typeof description !== 'string' || description.trim() === '') {
          undocumented.push(`${tool.name}.${key}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
    expect(undocumented).toEqual([]);
  });

  it('rejects camelCase aliases on custom tool schemas', () => {
    const runSql = CUSTOM_TOOLS.find((tool) => tool.name === 'run_sql');
    expect(runSql).toBeDefined();
    if (!(runSql?.inputSchema instanceof z.ZodObject)) {
      throw new Error('run_sql must keep a Zod object schema');
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

function byName(name: string) {
  const tool = NEON_TOOLS.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`No tool named ${name}`);
  return tool;
}

describe('published tool names', () => {
  it('publishes every name in mcp-tool-names.json under its selector', () => {
    expect(NEON_TOOLS.map((tool) => tool.name).sort()).toEqual(
      Object.keys(MCP_TOOL_NAMES).sort(),
    );
    for (const [name, id] of Object.entries(MCP_TOOL_NAMES)) {
      expect(byName(name).id, name).toBe(id);
    }
  });

  it('pins the names that differ from the package defaults', () => {
    expect(byName('describe_project').id).toBe('projects.get');
    expect(byName('reset_from_parent').id).toBe('branches.resetFromParent');
    expect(byName('compare_database_schema').id).toBe('branches.compareSchema');
    expect(byName('list_branch_computes').id).toBe(
      'postgres.endpoints.listByBranch',
    );
    expect(byName('provision_neon_auth').id).toBe('auth.create');
    expect(byName('get_connection_string').id).toBe(
      'postgres.connectionString',
    );
    expect(byName('run_sql_transaction').id).toBe('sql.runTransaction');
    expect(byName('search').id).toBe('resources.search');
    expect(byName('fetch').id).toBe('resources.fetch');
    expect(byName('get_doc').id).toBe('docs.get');
  });

  it('resolves every cross-reference to the name the tool publishes', () => {
    const defaultIds = TOOL_IDS.map((id) => publishedId(id)).filter(
      (id) => !NEON_TOOLS.some((tool) => tool.name === id),
    );
    expect(defaultIds.length).toBeGreaterThan(0);
    for (const tool of NEON_TOOLS) {
      expect(tool.description, tool.name).not.toContain('{{');
      const schema = JSON.stringify(toListedTool(tool).inputSchema);
      expect(schema, tool.name).not.toContain('{{');
      for (const id of defaultIds) {
        expect(tool.description, tool.name).not.toMatch(
          new RegExp(`\\b${id}\\b`),
        );
      }
    }
    expect(byName('create_branch').description).toContain(
      'get_connection_string',
    );
    expect(byName('prepare_database_migration').description).toContain(
      'complete_database_migration',
    );
    expect(byName('explain_sql_statement').description).toContain('run_sql');
  });
});

describe('MCP description notes', () => {
  it.each(['list_projects', 'count_projects', 'create_project'])(
    '%s says org_id is optional and auto-selected',
    (name) => {
      const { description } = byName(name);
      expect(description).toContain('`org_id` is optional');
      expect(description).toContain('auto-select when unambiguous');
    },
  );

  it('says get_connection_string follows the connection scope and is withheld in read-only mode', () => {
    const { description } = byName('get_connection_string');
    expect(description).toContain('`project_id` follows the connection scope');
    expect(description).toContain('unavailable in read-only mode');
    expect(description).toContain('https://console.neon.tech');
  });

  it('says get_realtime_secret is withheld in read-only mode', () => {
    expect(byName('get_realtime_secret').description).toContain(
      'unavailable in read-only mode',
    );
  });

  it('adds no notes to other tools', () => {
    for (const tool of NEON_TOOLS) {
      if (
        [
          'list_projects',
          'count_projects',
          'create_project',
          'get_connection_string',
          'get_realtime_secret',
        ].includes(tool.name)
      ) {
        continue;
      }
      expect(tool.description, tool.name).toBe(
        PACKAGE_TOOLS[tool.id].description,
      );
    }
  });
});

describe('generated tool interface', () => {
  it('does not take a cursor on paginated lists', () => {
    for (const name of [
      'query_logs',
      'list_operations',
      'list_projects',
      'list_functions_custom_domains',
      'get_project_consumption',
      'get_branch_consumption',
    ]) {
      expect(generatedShape(byName(name)), name).not.toHaveProperty('cursor');
      expect(byName(name).description, name).toContain('Returns every page');
    }
  });

  it('keeps query_logs filter and time-window constraints', () => {
    const { description } = byName('query_logs');
    expect(description).toContain('logql');
    expect(description).toContain('since');
    expect(description).toContain('start_time');
    expect(description).toContain('not both');
  });

  it('names list_log_field_values on list_log_fields', () => {
    const { description } = byName('list_log_fields');
    expect(description).toContain('list_log_field_values');
    expect(description).not.toContain('field-values endpoint');
  });

  it('keeps list_log_field_values window constraints', () => {
    const { description } = byName('list_log_field_values');
    expect(description).toContain('unknown_field');
    expect(description).toContain('six hours');
    expect(description).not.toContain('previous hour');
  });

  it('exposes query_loki_logs as a read-only observability tool that points at the log discovery tools', () => {
    const tool = byName('query_loki_logs');
    expect(tool.scope).toBe('observability');
    expect(tool.readOnlySafe).toBe(true);
    expect(tool.annotations.destructiveHint).toBe(false);
    expect(tool.description).toContain('query_logs');
    expect(tool.description).toContain('list_log_fields');
    expect(tool.description).toMatch(/no cursor/i);
    expect(
      NEON_TOOLS.some((t) => /labels?_.*loki|loki.*labels?/.test(t.name)),
    ).toBe(false);
  });

  it('keeps deploy_function zip and first-deployment constraints', () => {
    const { description } = byName('deploy_function');
    expect(description).toContain('zip');
    expect(description).toContain('first deployment');
  });

  it('exposes functions custom-domain tools under the functions category', () => {
    const list = byName('list_functions_custom_domains');
    const register = byName('register_functions_custom_domain');
    const remove = byName('delete_functions_custom_domain');
    expect(list.scope).toBe('functions');
    expect(register.scope).toBe('functions');
    expect(remove.scope).toBe('functions');
    expect(generatedShape(register)).toHaveProperty('entity_type');
    expect(generatedShape(register)).toHaveProperty('entity_id');
    expect(generatedShape(register)).toHaveProperty('domain');
    expect(generatedShape(remove)).toHaveProperty('domain');
    expect(register.description).toContain('list_functions');
    expect(register.description).toContain('cname_target');
  });

  it('exposes trigger tools under the functions category', () => {
    for (const name of [
      'list_triggers',
      'create_trigger',
      'update_trigger',
      'delete_trigger',
    ]) {
      expect(byName(name).scope, name).toBe('functions');
    }
    expect(NEON_TOOLS.some((tool) => tool.name === 'reveal_credentials')).toBe(
      false,
    );
  });

  it('exposes credential tools under the branches category and hides reveal', () => {
    for (const name of [
      'list_credentials',
      'create_credential',
      'revoke_credential',
      'rotate_credential',
    ]) {
      expect(byName(name).scope, name).toBe('branches');
    }
    const rotate = byName('rotate_credential');
    expect(rotate.annotations.destructiveHint).toBe(true);
    expect(rotate.annotations.idempotentHint).toBe(false);
    expect(rotate.readOnlySafe).toBe(false);
  });

  it('exposes Realtime tools under the realtime category and keeps the secret out of read-only mode', () => {
    const get = byName('get_realtime');
    const enable = byName('enable_realtime');
    const disable = byName('disable_realtime');
    const secret = byName('get_realtime_secret');
    const rotate = byName('rotate_realtime_secret');
    for (const tool of [get, enable, disable, secret, rotate]) {
      expect(tool.scope).toBe('realtime');
    }
    expect(get.readOnlySafe).toBe(true);
    expect(enable.readOnlySafe).toBe(false);
    expect(disable.annotations.destructiveHint).toBe(true);
    expect(secret.readOnlySafe).toBe(false);
    expect(secret.annotations.readOnlyHint).toBe(true);
    expect(rotate.readOnlySafe).toBe(false);
    expect(rotate.annotations.destructiveHint).toBe(true);
    expect(rotate.annotations.idempotentHint).toBe(false);
  });

  it('exposes the Neon Auth OAuth server and client tools under neon_auth', () => {
    const reads = [
      'get_auth_oauth_server',
      'list_auth_oauth_clients',
      'get_auth_oauth_client',
    ];
    const writes = [
      'update_auth_oauth_server',
      'create_auth_oauth_client',
      'update_auth_oauth_client',
      'delete_auth_oauth_client',
      'rotate_auth_oauth_client_secret',
    ];
    for (const name of [...reads, ...writes]) {
      expect(byName(name).scope, name).toBe('neon_auth');
      expect(byName(name).projectScoped, name).toBe(true);
    }
    for (const name of reads) {
      expect(byName(name).readOnlySafe, name).toBe(true);
      expect(byName(name).annotations.readOnlyHint, name).toBe(true);
      expect(byName(name).annotations.destructiveHint, name).toBe(false);
    }
    for (const name of writes) {
      expect(byName(name).readOnlySafe, name).toBe(false);
      expect(byName(name).annotations.readOnlyHint, name).toBe(false);
    }
    for (const name of [
      'update_auth_oauth_server',
      'update_auth_oauth_client',
      'delete_auth_oauth_client',
      'rotate_auth_oauth_client_secret',
    ]) {
      expect(byName(name).annotations.destructiveHint, name).toBe(true);
    }
    expect(byName('rotate_auth_oauth_client_secret').annotations).toMatchObject(
      { idempotentHint: false },
    );
  });

  it('tells the agent how the OAuth server tools differ from social login', () => {
    expect(byName('get_auth_oauth_server').description).toContain(
      'list_auth_oauth_providers',
    );
    expect(byName('create_auth_oauth_client').description).toContain(
      'client_secret',
    );
  });

  it('publishes count and v2 consumption as read-only org-level project tools', () => {
    for (const name of [
      'count_projects',
      'get_project_consumption',
      'get_branch_consumption',
    ]) {
      expect(byName(name), name).toMatchObject({
        scope: 'projects',
        readOnlySafe: true,
        projectScoped: false,
        annotations: { readOnlyHint: true, destructiveHint: false },
      });
    }
    const project = byName('get_project_consumption').description;
    const branch = byName('get_branch_consumption').description;
    expect(project).toContain('Business');
    expect(project).toContain('snapshot_storage_bytes_month');
    expect(project).toContain('get_branch_consumption');
    expect(branch).toContain('compute_unit_seconds');
    expect(branch).not.toContain('Business');
  });

  it('does not publish the legacy-plan consumption endpoint', () => {
    expect(Object.keys(GENERATED_TOOL_SCOPES)).not.toContain(
      'consumption.perProject',
    );
    expect(
      NEON_TOOLS.some((tool) => tool.name === 'per_project_consumption'),
    ).toBe(false);
  });

  it('points describe_project at list_branches', () => {
    expect(byName('describe_project').description).toContain('list_branches');
  });

  it('names finalize_branch_restore on restore_snapshot', () => {
    const restore = byName('restore_snapshot');
    expect(generatedShape(restore)).toHaveProperty('finalize');
    expect(generatedShape(restore)).not.toHaveProperty('finalize_restore');
    expect(restore.description).toContain('target_branch_id');
    expect(restore.description).toContain('finalize_branch_restore');
    expect(restore.description).not.toContain('preview callbacks');

    const finalize = byName('finalize_branch_restore');
    expect(finalize.description).toContain('finalize false');
    expect(finalize.description).toContain('restarting');
    expect(finalize.description).not.toContain('restoreSnapshot');
    expect(finalize.description).not.toContain('finalize_restore');
  });

  it('exposes flat arguments on the project list, create, and delete tools', () => {
    const listProjects = byName('list_projects');
    const createProject = byName('create_project');
    const deleteProject = byName('delete_project');

    expect(generatedShape(listProjects)).toHaveProperty('limit');
    expect(generatedShape(createProject)).toHaveProperty('name');
    expect(generatedShape(createProject)).toHaveProperty('org_id');
    expect(generatedShape(createProject)).not.toHaveProperty('pooled');
    expect(createProject.description).toContain('get_connection_string');
    expect(createProject.description).not.toContain(
      'returns a connection string',
    );
    expect(generatedShape(deleteProject)).toHaveProperty('project_id');
    expect(generatedShape(listProjects)).not.toHaveProperty('query');
    expect(generatedShape(createProject)).not.toHaveProperty('body');
    expect(generatedShape(deleteProject)).not.toHaveProperty('path');
  });

  it('marks additive creates as non-destructive and deletes as destructive', () => {
    expect(byName('create_project').annotations.destructiveHint).toBe(false);
    expect(byName('create_branch').annotations.destructiveHint).toBe(false);
    expect(byName('delete_project').annotations.destructiveHint).toBe(true);
    expect(byName('finalize_branch_restore').annotations.destructiveHint).toBe(
      true,
    );
    expect(byName('set_default_branch').annotations.destructiveHint).toBe(true);
  });

  it('describes create_branch as a compute workflow without a connection string', () => {
    const createBranch = byName('create_branch');
    const shape = generatedShape(createBranch);
    expect(shape).toHaveProperty('project_id');
    expect(shape).toHaveProperty('name');
    expect(shape).toHaveProperty('no_compute');
    expect(shape).not.toHaveProperty('pooled');
    expect(shape).not.toHaveProperty('branch');
    expect(shape).not.toHaveProperty('endpoints');
    expect(createBranch.description).toContain('get_connection_string');
    expect(createBranch.description).not.toContain(
      'returns a connection string',
    );
  });

  it('pins reset_from_parent and compare_database_schema', () => {
    const reset = byName('reset_from_parent');
    expect(reset.scope).toBe('branches');
    expect(reset.readOnlySafe).toBe(false);
    expect(reset.annotations.destructiveHint).toBe(true);
    expect(reset.description).toContain('NEVER run autonomously');
    expect(reset.description).toContain('restore_snapshot');
    expect(generatedShape(reset)).toHaveProperty('preserve_under_name');
    expect(generatedShape(reset)).not.toHaveProperty('preserveUnderName');
    expect(
      reset.inputSchema.safeParse({
        project_id: 'proj',
        branch_id: 'br-1',
      }).success,
    ).toBe(true);
    expect(
      reset.inputSchema.safeParse({
        project_id: 'proj',
        branch_id: 'br-1',
        preserveUnderName: 'old',
      }).success,
    ).toBe(false);

    const compare = byName('compare_database_schema');
    expect(compare.scope).toBe('schema');
    expect(compare.readOnlySafe).toBe(true);
    expect(compare.annotations.readOnlyHint).toBe(true);
    expect(generatedShape(compare)).toHaveProperty('database_name');
    expect(generatedShape(compare)).toHaveProperty('base_branch_id');
    expect(generatedShape(compare)).toHaveProperty('lsn');
    expect(generatedShape(compare)).not.toHaveProperty('db_name');
    expect(compare.description).not.toContain('run_sql');
    expect(compare.description).toContain('parent');
    expect(compare.description).toContain('point-in-time');
    expect(
      compare.inputSchema.safeParse({
        project_id: 'proj',
        branch_id: 'br-1',
        database_name: 'neondb',
      }).success,
    ).toBe(true);
    expect(
      compare.inputSchema.safeParse({
        project_id: 'proj',
        branch_id: 'br-1',
        db_name: 'neondb',
      }).success,
    ).toBe(false);
  });

  it('keeps the never-run-autonomously text on delete_branch and delete_project', () => {
    const deleteBranch = byName('delete_branch');
    const deleteProject = byName('delete_project');
    expect(deleteBranch.description).toContain('NEVER run autonomously');
    expect(deleteBranch.description).toContain('delete_project');
    expect(deleteProject.description).toContain('NEVER run autonomously');
    expect(deleteProject.description).toContain('delete_branch');
  });

  it('keeps workflow constraints in the custom tool descriptions', () => {
    expect(byName('prepare_database_migration').description).toContain(
      'complete_database_migration',
    );
    const completeMigration = byName('complete_database_migration');
    expect(completeMigration.description).toContain(
      'prepare_database_migration',
    );
    expect(completeMigration.description).toContain(
      'apply_changes false discards',
    );
    const prepareTuning = byName('prepare_query_tuning');
    expect(prepareTuning.description).toContain('tuning_id');
    expect(prepareTuning.description).toContain('explain_sql_statement');
    expect(prepareTuning.description).toContain('complete_query_tuning');
    expect(prepareTuning.description).toContain('prepare_database_migration');
    const completeTuning = byName('complete_query_tuning');
    expect(completeTuning.description).toContain('even when the user rejects');
    expect(completeTuning.description).toContain('apply_changes true applies');
    expect(byName('get_neon_auth_config').description).toContain('redacted');
    expect(byName('run_sql').description).toContain('temporary branch');
    const inspect = byName('inspect_database');
    expect(inspect.description).toContain('CREATE EXTENSION');
    expect(inspect.description).toContain('ask before');
  });

  it('describes branch_id as an id, not a name, on tools that take a path branch_id', () => {
    let checked = 0;
    for (const tool of NEON_TOOLS.filter(
      (candidate) => candidate.kind === 'generated',
    )) {
      if (!PACKAGE_TOOLS[tool.id].metadata.path.includes('{branch_id}')) {
        continue;
      }
      checked += 1;
      const branchId = generatedShape(tool).branch_id;
      expect(branchId, tool.name).toBeInstanceOf(z.ZodType);
      if (!(branchId instanceof z.ZodType)) continue;
      expect(z.globalRegistry.get(branchId)?.description, tool.name).toContain(
        'not a name',
      );
      expect(tool.description, tool.name).not.toContain(
        'branch_id is a branch id (br-...), not a branch name',
      );
    }
    expect(checked).toBeGreaterThan(50);
  });
});
