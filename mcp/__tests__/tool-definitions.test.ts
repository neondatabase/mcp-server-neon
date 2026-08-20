/**
 * Tests for tool definitions integrity.
 *
 * Validates the NEON_TOOLS array and NEON_HANDLERS mapping
 * to catch missing handlers, incorrect annotations, or
 * accidental tool count regressions.
 */

import { describe, it, expect } from 'vitest';
import { HOST_TOOLS, NEON_TOOLS } from '../tools/definitions';
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
  'get_connection_uri',
  'get_project_branch_role_password',
  'get_neon_auth_email_provider',
  'get_neon_auth_email_server',
  'get_neon_auth_plugin_configs',
  'list_branch_neon_auth_oauth_providers',
  'list_neon_auth_oauth_providers',
];

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

  it('treats query_project_branch_logs as read-only despite POST', () => {
    const tool = NEON_TOOLS.find((t) => t.name === 'query_project_branch_logs');
    expect(tool).toBeDefined();
    expect(tool!.readOnlySafe).toBe(true);
    expect(tool!.annotations.readOnlyHint).toBe(true);
    expect(tool!.annotations.destructiveHint).toBe(false);
  });

  it('does not expose secret-returning generated tools', () => {
    const names = new Set(NEON_TOOLS.map((t) => t.name));
    for (const name of SECRET_GENERATED_TOOLS) {
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
