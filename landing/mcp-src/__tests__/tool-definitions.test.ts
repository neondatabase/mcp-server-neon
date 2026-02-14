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
  it('has 29 tools', () => {
    expect(NEON_TOOLS).toHaveLength(29);
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

describe('read-only safety consistency', () => {
  it('tools with readOnlyHint: true are marked readOnlySafe: true', () => {
    for (const tool of NEON_TOOLS) {
      if (tool.annotations.readOnlyHint) {
        expect(
          tool.readOnlySafe,
          `${tool.name} has readOnlyHint but not readOnlySafe`,
        ).toBe(true);
      }
    }
  });

  it('counts expected number of read-only tools', () => {
    const readOnlyTools = NEON_TOOLS.filter((t) => t.readOnlySafe);
    // run_sql and run_sql_transaction are readOnlySafe but not readOnlyHint
    // (they can both read and write)
    expect(readOnlyTools.length).toBeGreaterThanOrEqual(18);
  });
});
