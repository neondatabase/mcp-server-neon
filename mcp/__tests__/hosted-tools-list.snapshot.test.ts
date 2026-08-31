import { describe, expect, it } from 'vitest';
import { NEON_TOOLS } from '../tools/definitions';
import { getFilteredTools } from '../tools/grant-filter';
import { toListedTool } from '../tools/listed-schema';

const ALWAYS_AVAILABLE_NAMES = new Set(
  getFilteredTools({ projectId: null, scopes: [] }, false).map(
    (tool) => tool.name,
  ),
);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function argumentList(inputSchema: Record<string, unknown>): string {
  const properties = inputSchema.properties;
  if (!isPlainObject(properties)) {
    return '';
  }

  const requiredRaw = inputSchema.required;
  const required = new Set(
    Array.isArray(requiredRaw)
      ? requiredRaw.filter((item): item is string => typeof item === 'string')
      : [],
  );

  return Object.keys(properties)
    .map((name) => (required.has(name) ? name : `${name}?`))
    .join(', ');
}

function markdownCell(value: string | boolean): string {
  return String(value).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function catalogRows() {
  return NEON_TOOLS.map((tool) => {
    const listed = toListedTool(tool);
    return {
      listed,
      kind: tool.kind,
      scope: tool.scope ?? 'global',
      public: tool.scope === 'docs',
      alwaysAvailable: ALWAYS_AVAILABLE_NAMES.has(tool.name),
      projectScoped: tool.projectScoped,
      readOnlySafe: tool.readOnlySafe,
      arguments: argumentList(listed.inputSchema),
    };
  });
}

function catalogMarkdown(): string {
  const rows = [...catalogRows()].sort((a, b) =>
    a.listed.name.localeCompare(b.listed.name),
  );

  const header = [
    'name',
    'title',
    'description',
    'arguments',
    'public',
    'kind',
    'scope',
    'alwaysAvailable',
    'projectScoped',
    'readOnlySafe',
    'readOnlyHint',
    'destructiveHint',
    'idempotentHint',
    'openWorldHint',
  ];

  const lines = [
    '# Hosted MCP tool catalog',
    '',
    'Default-grant `tools/list` plus host flags. `public` means the unauthenticated docs MCP (`?category=docs`). `readOnlySafe` is the server read-only allowlist; `readOnlyHint` is the MCP annotation.',
    '',
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
  ];

  for (const row of rows) {
    const annotations = row.listed.annotations;
    lines.push(
      `| ${[
        row.listed.name,
        row.listed.title ?? '',
        row.listed.description,
        row.arguments,
        row.public,
        row.kind,
        row.scope,
        row.alwaysAvailable,
        row.projectScoped,
        row.readOnlySafe,
        annotations.readOnlyHint ?? '',
        annotations.destructiveHint ?? '',
        annotations.idempotentHint ?? '',
        annotations.openWorldHint ?? '',
      ]
        .map(markdownCell)
        .join(' | ')} |`,
    );
  }

  return `${lines.join('\n')}\n`;
}

describe('hosted tools/list catalog', () => {
  it('snapshots the default-grant tools/list payload', async () => {
    const listed = catalogRows().map((row) => row.listed);
    await expect(`${JSON.stringify(listed, null, 2)}\n`).toMatchFileSnapshot(
      './__snapshots__/hosted-tools-list.json',
    );
  });

  it('snapshots a table of list fields and MCP flags', async () => {
    await expect(catalogMarkdown()).toMatchFileSnapshot(
      './__snapshots__/hosted-tools-catalog.md',
    );
  });
});
