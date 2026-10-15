import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v3';
import { z as z4 } from 'zod';
import { filterToolsForGrant, injectProjectId } from '../tools/grant-filter';
import { toListedInputSchema } from '../tools/listed-schema';
import type { NeonTool } from '../tools/tool-definition';
import type { GrantContext } from '../utils/grant-context';

// These tests pass their own host/generated Zod tools to the real filter.
// Avoid initializing the unrelated Neon SDK catalog and its handlers.
vi.mock('../tools/definitions', () => ({ NEON_TOOLS: [] }));

const unscoped: GrantContext = { projectId: null, scopes: null };
const scoped: GrantContext = { projectId: 'project-a', scopes: null };

const fixtures: NeonTool[] = [
  {
    kind: 'host',
    name: 'host_query',
    scope: 'querying',
    description: 'Host query fixture',
    inputSchema: z
      .object({ project_id: z.string(), sql: z.string().min(1) })
      .strict(),
    readOnlySafe: true,
    projectScoped: true,
    annotations: {},
  },
  {
    kind: 'generated',
    name: 'generated_branch',
    scope: 'branches',
    description: 'Generated branch fixture',
    inputSchema: z4.strictObject({
      project_id: z4.string(),
      branch_id: z4.string().min(1),
    }),
    readOnlySafe: true,
    projectScoped: true,
    annotations: {},
  },
];

function argumentsFor(tool: NeonTool): Record<string, unknown> {
  return tool.kind === 'host' ? { sql: 'SELECT 1' } : { branch_id: 'branch-a' };
}

function published(tool: NeonTool, grant: GrantContext): NeonTool {
  const result = filterToolsForGrant([tool], grant)[0];
  if (!result) throw new Error('Fixture tool was unexpectedly filtered');
  return result;
}

describe.each(fixtures)('$kind stable project schema', (tool) => {
  it('publishes the same optional project_id schema across grants', () => {
    const scopedSchema = toListedInputSchema(
      published(tool, scoped).inputSchema,
    );
    const unscopedSchema = toListedInputSchema(
      published(tool, unscoped).inputSchema,
    );
    expect(scopedSchema).toEqual(unscopedSchema);
    expect(scopedSchema).toMatchObject({
      properties: {
        project_id: {
          type: 'string',
          description: expect.stringContaining(
            'Required for an unscoped connection',
          ),
        },
      },
      additionalProperties: false,
    });
    expect(scopedSchema).not.toMatchObject({
      required: expect.arrayContaining(['project_id']),
    });
    expect(JSON.stringify(scopedSchema)).not.toContain('project-a');
  });

  it('requires an explicit ID for an unscoped full handler', () => {
    const args = argumentsFor(tool);
    const wireArgs = published(tool, unscoped).inputSchema.parse(args);
    expect(() => injectProjectId(wireArgs, unscoped, tool)).toThrow(
      'project_id is required because this connection is not scoped to a project',
    );

    const explicit = { ...args, project_id: 'project-b' };
    const explicitWire = published(tool, unscoped).inputSchema.parse(explicit);
    expect(
      tool.inputSchema.parse(injectProjectId(explicitWire, unscoped, tool)),
    ).toEqual(explicit);
  });

  it.each([undefined, 'project-a'])(
    'uses the scoped grant with project_id=%s',
    (projectId) => {
      const args = {
        ...argumentsFor(tool),
        ...(projectId === undefined ? {} : { project_id: projectId }),
      };
      const wireArgs = published(tool, scoped).inputSchema.parse(args);
      const effective = injectProjectId(wireArgs, scoped, tool);
      expect(tool.inputSchema.parse(effective)).toEqual({
        ...argumentsFor(tool),
        project_id: 'project-a',
      });
      expect(args).toEqual({
        ...argumentsFor(tool),
        ...(projectId === undefined ? {} : { project_id: projectId }),
      });
    },
  );

  it('rejects a conflicting ID before invoking a scoped handler', () => {
    const args = { ...argumentsFor(tool), project_id: 'project-b' };
    const wireArgs = published(tool, scoped).inputSchema.parse(args);
    expect(() => injectProjectId(wireArgs, scoped, tool)).toThrow(
      `does not match this connection's project "project-a"`,
    );
  });

  it('keeps unknown-key rejection and the original full schema', () => {
    const originalSchema = tool.inputSchema;
    const originalJson = toListedInputSchema(originalSchema);
    const args = argumentsFor(tool);
    for (const grant of [scoped, unscoped]) {
      const wireSchema = published(tool, grant).inputSchema;
      for (const extra of [{ projectId: 'project-a' }, { unexpected: true }]) {
        expect(wireSchema.safeParse({ ...args, ...extra }).success).toBe(false);
      }
      expect(wireSchema.safeParse({ ...args, project_id: null }).success).toBe(
        false,
      );
      expect(wireSchema.safeParse({}).success).toBe(false);
    }
    expect(tool.inputSchema).toBe(originalSchema);
    expect(toListedInputSchema(tool.inputSchema)).toEqual(originalJson);
    expect(tool.inputSchema.safeParse(args).success).toBe(false);
  });
});

describe('unchanged tool visibility and tools without a project ID', () => {
  const globalTool: NeonTool = {
    ...fixtures[0],
    name: 'global_admin',
    projectScoped: false,
  };
  const docsTool: NeonTool = {
    ...fixtures[0],
    name: 'docs',
    scope: 'docs',
    inputSchema: z.object({ slug: z.string() }).strict(),
  };

  it('retains project/category filtering and global full schemas', () => {
    const tools = [...fixtures, globalTool, docsTool];
    expect(filterToolsForGrant(tools, scoped).map((tool) => tool.name)).toEqual(
      ['host_query', 'generated_branch', 'docs'],
    );
    expect(
      filterToolsForGrant(tools, { ...scoped, scopes: ['querying'] }).map(
        (tool) => tool.name,
      ),
    ).toEqual(['host_query']);
    expect(published(globalTool, unscoped).inputSchema).toBe(
      globalTool.inputSchema,
    );
    expect(
      published(globalTool, unscoped).inputSchema.safeParse({ sql: 'SELECT 1' })
        .success,
    ).toBe(false);
  });

  it('leaves docs schemas and arguments unchanged', () => {
    for (const grant of [scoped, unscoped]) {
      expect(published(docsTool, grant).inputSchema).toBe(docsTool.inputSchema);
      const args = { slug: 'docs/example' };
      expect(injectProjectId(args, grant, docsTool)).toBe(args);
    }
  });
});
