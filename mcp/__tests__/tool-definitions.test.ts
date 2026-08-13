/**
 * Tests for tool definitions integrity.
 *
 * Validates the NEON_TOOLS array and NEON_HANDLERS mapping
 * to catch missing handlers, incorrect annotations, or
 * accidental tool count regressions.
 */

import { describe, it, expect } from 'vitest';
import { NEON_TOOLS } from '../tools/definitions';
import { NEON_HANDLERS } from '../tools/tools';
import { SCOPE_CATEGORIES } from '../utils/grant-context';

describe('NEON_TOOLS definitions', () => {
  it('has 35 tools', () => {
    expect(NEON_TOOLS).toHaveLength(35);
  });

  it('every tool has a name, scope (or null), and readOnlySafe flag', () => {
    for (const tool of NEON_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(
        tool.scope === null || SCOPE_CATEGORIES.includes(tool.scope),
        `${tool.name} has invalid scope: ${String(tool.scope)}`,
      ).toBe(true);
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

/**
 * The exact set of tools a read-only caller may reach.
 *
 * This is an allowlist rather than a count on purpose: changing the read-only
 * surface is a security decision, so it should require editing a named list and
 * explaining the entry in review, not just moving a number that happens to
 * still match.
 *
 * Note that `readOnlySafe` and `annotations.readOnlyHint` are independent axes,
 * and neither implies the other:
 *   - `run_sql` mutates (`readOnlyHint: false`) but is reachable, because
 *     read-only mode wraps it in a read-only transaction.
 *   - `get_connection_string` mutates nothing (`readOnlyHint: true`) but is not
 *     reachable, because the URI it returns carries a privileged role password
 *     that works against the read-write compute.
 */
const READ_ONLY_TOOLS = [
  'compare_database_schema',
  'describe_branch',
  'describe_project',
  'describe_table_schema',
  'explain_sql_statement',
  'fetch',
  'get_database_tables',
  'get_doc_resource',
  'get_neon_auth_config',
  'inspect_database',
  'list_branch_computes',
  'list_docs_resources',
  'list_log_field_values',
  'list_log_fields',
  'list_organizations',
  'list_projects',
  'list_shared_projects',
  'list_slow_queries',
  'query_logs',
  'run_sql',
  'run_sql_transaction',
  'search',
];

describe('read-only tool surface', () => {
  it('exposes exactly the allowlisted tools', () => {
    const readOnlyNames = NEON_TOOLS.filter((t) => t.readOnlySafe).map(
      (t) => t.name,
    );

    expect([...readOnlyNames].sort()).toEqual([...READ_ONLY_TOOLS].sort());
  });

  it('withholds get_connection_string, which returns a privileged password', () => {
    const tool = NEON_TOOLS.find((t) => t.name === 'get_connection_string');

    expect(tool!.readOnlySafe).toBe(false);
  });
});
