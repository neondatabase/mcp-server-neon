import { describe, it, expect } from 'vitest';
import { z } from 'zod/v3';
import {
  filterToolsForGrant,
  getAvailableTools,
  getFilteredTools,
  getAccessControlNotices,
  getAccessControlWarnings,
  injectProjectId,
} from '../tools/grant-filter';
import type { GrantContext, ScopeCategory } from '../utils/grant-context';
import { NEON_TOOLS } from '../tools/definitions';

type NeonTool = (typeof NEON_TOOLS)[number];

function syntheticTool(name: string, inputSchema: z.ZodTypeAny): NeonTool {
  return {
    name,
    scope: null,
    description: 'synthetic test tool',
    inputSchema,
    readOnlySafe: false,
    annotations: {
      title: name,
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  } as unknown as NeonTool;
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
    expect(tools).toHaveLength(10);
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
    expect(tools).toHaveLength(33);
    expect(names).not.toContain('list_projects');
    expect(names).not.toContain('create_project');
    expect(names).not.toContain('search');
    expect(names).not.toContain('fetch');
    expect(names).toContain('describe_project');
  });

  it('removes projectId from refined schemas without dropping refinements', () => {
    const tools = filterToolsForGrant(
      NEON_TOOLS,
      grant({ projectId: 'proj-123', scopes: null }),
    );
    const tool = tools.find(
      (t) => t.name === 'neon_auth_sign_in_methods_update',
    );
    expect(tool).toBeDefined();
    expect(
      tool!.inputSchema.safeParse({ email_password: { enabled: true } })
        .success,
    ).toBe(true);
    expect(tool!.inputSchema.safeParse({}).success).toBe(false);
  });

  it('removes projectId from strict object schemas without allowing unknown keys', () => {
    const tools = filterToolsForGrant(
      NEON_TOOLS,
      grant({ projectId: 'proj-123', scopes: null }),
    );
    const tool = tools.find(
      (t) => t.name === 'neon_auth_email_delivery_update',
    );
    expect(tool).toBeDefined();
    expect(
      tool!.inputSchema.safeParse({
        email_delivery: { type: 'shared' },
      }).success,
    ).toBe(true);
    expect(
      tool!.inputSchema.safeParse({
        email_delivery: { type: 'shared' },
        unknown: true,
      }).success,
    ).toBe(false);
  });

  it('combines scope and project filtering', () => {
    const tools = filterToolsForGrant(
      NEON_TOOLS,
      grant({ projectId: 'proj-123', scopes: ['querying'] }),
    );
    expect(tools).toHaveLength(8);
    const names = tools.map((t) => t.name);
    expect(names).toContain('run_sql');
    expect(names).not.toContain('search');
    expect(names).not.toContain('fetch');
  });
});

describe('getAvailableTools', () => {
  it('applies read-only filter after grant filtering', () => {
    const tools = getAvailableTools(grant({ scopes: ['querying'] }), true);
    expect(tools).toHaveLength(6);
    for (const tool of tools) {
      expect(tool.readOnlySafe).toBe(true);
    }
  });

  it('keeps full toolset when readOnly is false', () => {
    const tools = getAvailableTools(grant(), false);
    expect(tools).toHaveLength(NEON_TOOLS.length);
  });

  it('appends read-only notice to tool descriptions when read-only is enabled', () => {
    const tools = getAvailableTools(grant(), true);
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.description).toContain(
        'configured with read-only permissions',
      );
      expect(tool.description).toContain('<notice>');
    }
  });

  it('appends project-scoped notice with project id to tool descriptions', () => {
    const tools = getAvailableTools(grant({ projectId: 'proj-123' }), false);
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.description).toContain(
        'configured and scoped to one project only (proj-123)',
      );
    }
  });
});

describe('getFilteredTools (no notice suffix)', () => {
  // Issue #257: the REST endpoint surfaces notices as a top-level field,
  // so the filtered tool list must NOT carry the <notice> block in
  // descriptions. The MCP-protocol path (getAvailableTools) keeps the
  // notice inline as today.

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
  });

  it('returns both notices when both modes are active', () => {
    const notices = getAccessControlNotices(grant({ projectId: 'p-1' }), true);
    expect(notices).toHaveLength(2);
  });

  it('produces the same notices that getAvailableTools concatenates', () => {
    // Round-trip guard: the MCP-protocol path concatenates the same notices
    // we surface separately. If the strings ever drift, the regression
    // shows up here.
    const tools = getAvailableTools(grant({ projectId: 'p-1' }), true);
    const notices = getAccessControlNotices(grant({ projectId: 'p-1' }), true);
    for (const tool of tools) {
      for (const notice of notices) {
        expect(tool.description).toContain(notice);
      }
    }
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
  it('injects project id when grant is project-scoped', () => {
    const args = { branchId: 'br-1' };
    expect(injectProjectId(args, grant({ projectId: 'proj-123' }))).toEqual({
      branchId: 'br-1',
      projectId: 'proj-123',
    });
  });

  it('returns args unchanged when not project-scoped', () => {
    const args = { projectId: 'proj-keep', branchId: 'br-1' };
    expect(injectProjectId(args, grant())).toEqual(args);
  });
});

describe('removeProjectIdFromSchema (project-scoped behavior)', () => {
  // These tests exercise the schema-rewrite path via synthetic tools so we
  // can pin down each Zod shape variant without relying on real tool schemas.
  const scopedGrant = grant({ projectId: 'proj-1', scopes: null });

  it('ZodObject without projectId is left untouched (no-op)', () => {
    const original = z.object({ foo: z.string() });
    const tool = syntheticTool('no_project_id', original);
    const [filtered] = filterToolsForGrant([tool], scopedGrant);
    expect(filtered.inputSchema).toBe(original);
  });

  it('ZodObject with projectId returns a new schema with projectId omitted', () => {
    const tool = syntheticTool(
      'has_project_id',
      z.object({ projectId: z.string(), foo: z.string() }),
    );
    const [filtered] = filterToolsForGrant([tool], scopedGrant);
    expect(filtered.inputSchema).not.toBe(tool.inputSchema);
    expect(filtered.inputSchema.safeParse({ foo: 'bar' }).success).toBe(true);
    expect(
      filtered.inputSchema.safeParse({ projectId: 'x', foo: 'bar' }).success,
    ).toBe(true);
    // projectId is not part of the output shape any more.
    const parsed = filtered.inputSchema.parse({ foo: 'bar' });
    expect(parsed).toEqual({ foo: 'bar' });
  });

  it('preserves .strict() on the bare ZodObject so unknown keys still reject', () => {
    const tool = syntheticTool(
      'strict_object',
      z.object({ projectId: z.string(), foo: z.string() }).strict(),
    );
    const [filtered] = filterToolsForGrant([tool], scopedGrant);
    expect(filtered.inputSchema.safeParse({ foo: 'bar' }).success).toBe(true);
    expect(
      filtered.inputSchema.safeParse({ foo: 'bar', unknown: true }).success,
    ).toBe(false);
  });

  it('preserves .superRefine() across the omit (ZodEffects branch)', () => {
    // Mirrors the "at least one slice present" rule from
    // neon_auth_sign_in_methods_update — the regression we are fixing.
    const tool = syntheticTool(
      'refined_object',
      z
        .object({
          projectId: z.string(),
          a: z.boolean().optional(),
          b: z.boolean().optional(),
        })
        .strict()
        .superRefine((val, ctx) => {
          if (val.a === undefined && val.b === undefined) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'at least one of a or b is required',
            });
          }
        }),
    );
    const [filtered] = filterToolsForGrant([tool], scopedGrant);

    // Refinement still rejects payloads with neither slice.
    const empty = filtered.inputSchema.safeParse({});
    expect(empty.success).toBe(false);
    if (!empty.success) {
      expect(empty.error.issues[0].message).toContain('at least one of a or b');
    }

    // Refinement accepts payloads with one slice.
    expect(filtered.inputSchema.safeParse({ a: true }).success).toBe(true);
    expect(filtered.inputSchema.safeParse({ b: false }).success).toBe(true);

    // Inner .strict() still rejects unknown keys.
    expect(
      filtered.inputSchema.safeParse({ a: true, unknown: 1 }).success,
    ).toBe(false);
  });

  it('preserves .refine() across the omit (ZodEffects branch)', () => {
    const tool = syntheticTool(
      'refine_object',
      z
        .object({ projectId: z.string(), n: z.number() })
        .refine((val) => val.n > 0, { message: 'n must be positive' }),
    );
    const [filtered] = filterToolsForGrant([tool], scopedGrant);

    expect(filtered.inputSchema.safeParse({ n: 1 }).success).toBe(true);
    const bad = filtered.inputSchema.safeParse({ n: -1 });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0].message).toBe('n must be positive');
    }
  });

  it('non-object schemas (e.g. z.string()) are left untouched', () => {
    const tool = syntheticTool('plain_string', z.string());
    const [filtered] = filterToolsForGrant([tool], scopedGrant);
    expect(filtered.inputSchema).toBe(tool.inputSchema);
  });

  it('ZodEffects wrapping a non-object schema is left untouched', () => {
    const tool = syntheticTool(
      'effect_on_string',
      z.string().refine((s) => s.length > 0, { message: 'no empty' }),
    );
    const [filtered] = filterToolsForGrant([tool], scopedGrant);
    expect(filtered.inputSchema).toBe(tool.inputSchema);
  });

  it('ZodEffects whose inner object lacks projectId is left untouched', () => {
    const tool = syntheticTool(
      'effect_no_project_id',
      z
        .object({ foo: z.string() })
        .refine((val) => val.foo.length > 0, { message: 'non-empty' }),
    );
    const [filtered] = filterToolsForGrant([tool], scopedGrant);
    expect(filtered.inputSchema).toBe(tool.inputSchema);
  });
});

describe('scope coverage sanity', () => {
  it('all declared scope categories produce a deterministic result', () => {
    const categories: ScopeCategory[] = [
      'projects',
      'branches',
      'schema',
      'querying',
      'neon_auth',
      'data_api',
      'docs',
    ];

    for (const category of categories) {
      const tools = filterToolsForGrant(
        NEON_TOOLS,
        grant({ scopes: [category] }),
      );
      expect(tools.length).toBeGreaterThanOrEqual(2);
    }
  });
});
