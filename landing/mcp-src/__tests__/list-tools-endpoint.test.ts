import { describe, it, expect } from 'vitest';
import { GET, OPTIONS } from '../../app/api/list-tools/route';

type ListToolsResponse = {
  grant: {
    projectId: string | null;
    scopes: string[] | null;
  };
  readOnly: boolean;
  notices?: string[];
  warnings?: string[];
  tools: Array<{
    name: string;
    title: string;
    scope: string;
    readOnlySafe: boolean;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
};

async function callListTools(
  queryParams: Record<string, string | string[]> = {},
): Promise<ListToolsResponse> {
  const url = new URL('http://localhost/api/list-tools');
  for (const [key, value] of Object.entries(queryParams)) {
    if (Array.isArray(value)) {
      for (const v of value) {
        url.searchParams.append(key, v);
      }
    } else {
      url.searchParams.set(key, value);
    }
  }
  const req = new Request(url.toString());
  const res = await GET(req);
  return res.json() as Promise<ListToolsResponse>;
}

describe('/api/list-tools endpoint', () => {
  it('returns all tools by default', async () => {
    const body = await callListTools();
    expect(body.tools).toHaveLength(36);
    expect(body.readOnly).toBe(false);
    expect(body.grant).toEqual({
      projectId: null,
      scopes: null,
    });
  });

  it('filters by scopes when category param is present', async () => {
    const body = await callListTools({ category: 'querying' });
    expect(body.grant.scopes).toEqual(['querying']);
    expect(body.tools).toHaveLength(10);
  });

  it('returns only always-available tools when scopes are all invalid', async () => {
    const body = await callListTools({ category: 'foo,bar' });
    expect(body.grant.scopes).toEqual([]);
    expect(body.tools.map((t) => t.name).sort()).toEqual(['fetch', 'search']);
    expect(body.warnings?.[0]).toContain('No valid scope categories');
  });

  it('filters project-agnostic tools in project-scoped mode', async () => {
    const body = await callListTools({ projectId: 'proj-123' });
    expect(body.grant.projectId).toBe('proj-123');
    expect(body.tools).toHaveLength(29);
    const names = body.tools.map((t) => t.name);
    expect(names).not.toContain('list_projects');
    expect(names).not.toContain('create_project');
    expect(names).not.toContain('search');
    expect(names).not.toContain('fetch');
  });

  it('filters to readOnlySafe tools with readonly=true', async () => {
    const body = await callListTools({ readonly: 'true' });
    expect(body.readOnly).toBe(true);
    expect(body.tools).toHaveLength(18);
    for (const tool of body.tools) {
      expect(tool.readOnlySafe).toBe(true);
    }
  });

  it('supports legacy x-read-only header', async () => {
    const url = new URL('http://localhost/api/list-tools');
    const req = new Request(url.toString(), {
      headers: { 'x-read-only': 'true' },
    });
    const res = await GET(req);
    const body = (await res.json()) as ListToolsResponse;
    expect(body.readOnly).toBe(true);
    expect(body.tools).toHaveLength(18);
  });

  it('readonly query param takes precedence over x-read-only header', async () => {
    const url = new URL('http://localhost/api/list-tools');
    url.searchParams.set('readonly', 'false');
    const req = new Request(url.toString(), {
      headers: { 'x-read-only': 'true' },
    });
    const res = await GET(req);
    const body = (await res.json()) as ListToolsResponse;
    expect(body.readOnly).toBe(false);
    expect(body.tools).toHaveLength(36);
  });

  it('OPTIONS returns expected CORS allow-headers', () => {
    const res = OPTIONS();
    const allowed = res.headers.get('Access-Control-Allow-Headers') ?? '';
    expect(allowed).toBe('x-read-only');
  });

  // === Issue #257 — response shape additions ===
  // (1) inputSchema per tool, (2) top-level notices field (no per-tool dup),
  // (3) scope=null mapped to "global" for unambiguity.
  describe('issue #257 — inputSchema / notices / scope-global', () => {
    it('emits inputSchema on every tool as a JSON Schema object', async () => {
      const body = await callListTools();
      for (const tool of body.tools) {
        expect(typeof tool.inputSchema).toBe('object');
        expect(tool.inputSchema).not.toBeNull();
        // JSON Schema draft 7 marker.
        expect(tool.inputSchema['$schema']).toMatch(/json-schema\.org/);
      }
    });

    it('inputSchema captures Zod constraints (e.g. search.query min 3)', async () => {
      const body = await callListTools();
      const search = body.tools.find((t) => t.name === 'search');
      expect(search).toBeDefined();
      const props = (search!.inputSchema as { properties?: unknown })
        .properties as Record<string, { minLength?: number }>;
      // search has a query field constrained to min 3 characters per the
      // prose description — assert the constraint surfaces in the schema.
      expect(props.query?.minLength).toBe(3);
    });

    it('maps internal scope=null to "global" in the response', async () => {
      const body = await callListTools();
      const search = body.tools.find((t) => t.name === 'search');
      const fetch_ = body.tools.find((t) => t.name === 'fetch');
      expect(search?.scope).toBe('global');
      expect(fetch_?.scope).toBe('global');
      // Sanity-check that other tools keep their named scope.
      const listProjects = body.tools.find((t) => t.name === 'list_projects');
      expect(listProjects?.scope).toBe('projects');
    });

    it('surfaces the write-mode notice in the default response', async () => {
      const body = await callListTools();
      expect(body.notices).toBeDefined();
      expect(body.notices).toHaveLength(1);
      expect(body.notices?.[0]).toContain('Write mode active');
      // Per-tool descriptions must NOT carry the notice suffix on this
      // endpoint (issue #257).
      for (const tool of body.tools) {
        expect(tool.description).not.toContain('<notice>');
      }
    });

    it('surfaces the read-only notice at top level (not in each description) when readonly=true', async () => {
      const body = await callListTools({ readonly: 'true' });
      expect(body.notices).toBeDefined();
      expect(body.notices).toHaveLength(1);
      expect(body.notices?.[0]).toContain('read-only permissions');
      // Per-tool descriptions must NOT carry the <notice> suffix anymore —
      // that was the duplication the issue called out.
      for (const tool of body.tools) {
        expect(tool.description).not.toContain('<notice>');
        expect(tool.description).not.toContain('read-only permissions');
      }
    });

    it('surfaces the project-scope notice at top level (not in each description)', async () => {
      const body = await callListTools({ projectId: 'proj-123' });
      expect(body.notices?.some((n) => n.includes('proj-123'))).toBe(true);
      for (const tool of body.tools) {
        expect(tool.description).not.toContain('<notice>');
      }
    });

    it('surfaces both notices when both modes are active', async () => {
      const body = await callListTools({
        readonly: 'true',
        projectId: 'proj-123',
      });
      expect(body.notices).toHaveLength(2);
      expect(body.notices?.[0]).toContain('read-only');
      expect(body.notices?.[1]).toContain('proj-123');
    });
  });

  it('returns valid responses across repeated mixed-param requests', async () => {
    const paramSets: Record<string, string | string[]>[] = [
      {},
      { projectId: 'proj-123' },
      { category: 'querying' },
      { readonly: 'true' },
      {
        projectId: 'proj-123',
        category: 'querying,schema',
      },
      { category: 'not-a-real-scope' },
    ];

    const runs = Array.from({ length: 200 }, (_, i) =>
      callListTools(paramSets[i % paramSets.length]),
    );

    const bodies = await Promise.all(runs);
    expect(bodies).toHaveLength(200);

    for (const body of bodies) {
      expect(Array.isArray(body.tools)).toBe(true);
      expect(typeof body.readOnly).toBe('boolean');
      expect(body.grant).toBeDefined();
      expect(
        body.grant.projectId === null ||
          typeof body.grant.projectId === 'string',
      ).toBe(true);
      expect(
        body.grant.scopes === null || Array.isArray(body.grant.scopes),
      ).toBe(true);
    }
  });
});
