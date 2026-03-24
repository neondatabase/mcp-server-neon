import { describe, it, expect } from 'vitest';
import { GET, OPTIONS } from '../../app/api/list-tools/route';

type ListToolsResponse = {
  grant: {
    projectId: string | null;
    scopes: string[] | null;
  };
  readOnly: boolean;
  warnings?: string[];
  tools: Array<{
    name: string;
    title: string;
    scope: string | null;
    readOnlySafe: boolean;
    description: string;
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
    expect(body.tools).toHaveLength(29);
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
    expect(body.tools).toHaveLength(22);
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
    expect(body.tools).toHaveLength(29);
  });

  it('OPTIONS returns expected CORS allow-headers', () => {
    const res = OPTIONS();
    const allowed = res.headers.get('Access-Control-Allow-Headers') ?? '';
    expect(allowed).toBe('x-read-only');
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
