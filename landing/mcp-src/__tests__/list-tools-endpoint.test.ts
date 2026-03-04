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
  headers: Record<string, string> = {},
): Promise<ListToolsResponse> {
  const req = new Request('http://localhost/api/list-tools', { headers });
  const res = await GET(req);
  return res.json() as Promise<ListToolsResponse>;
}

describe('/api/list-tools endpoint', () => {
  it('returns all tools by default', async () => {
    const body = await callListTools();
    expect(body.tools).toHaveLength(29);
    expect(body.readOnly).toBe(false);
    expect(body.grant).toEqual({ projectId: null, scopes: null });
  });

  it('filters by scopes when X-Neon-Scopes is present', async () => {
    const body = await callListTools({ 'X-Neon-Scopes': 'querying' });
    expect(body.grant.scopes).toEqual(['querying']);
    expect(body.tools).toHaveLength(6);
  });

  it('returns only always-available tools when scopes are all invalid', async () => {
    const body = await callListTools({ 'X-Neon-Scopes': 'foo,bar' });
    expect(body.grant.scopes).toEqual([]);
    expect(body.tools.map((t) => t.name).sort()).toEqual(['fetch', 'search']);
    expect(body.warnings?.[0]).toContain('No valid scope categories');
  });

  it('filters project-agnostic tools in project-scoped mode', async () => {
    const body = await callListTools({ 'X-Neon-Project-Id': 'proj-123' });
    expect(body.grant.projectId).toBe('proj-123');
    expect(body.tools).toHaveLength(24);
    const names = body.tools.map((t) => t.name);
    expect(names).not.toContain('list_projects');
    expect(names).not.toContain('create_project');
  });

  it('filters to readOnlySafe tools with X-Neon-Read-Only=true', async () => {
    const body = await callListTools({ 'X-Neon-Read-Only': 'true' });
    expect(body.readOnly).toBe(true);
    expect(body.tools).toHaveLength(18);
    for (const tool of body.tools) {
      expect(tool.readOnlySafe).toBe(true);
    }
  });

  it('supports legacy x-read-only header', async () => {
    const body = await callListTools({ 'x-read-only': 'true' });
    expect(body.readOnly).toBe(true);
    expect(body.tools).toHaveLength(18);
  });

  it('X-Neon-Read-Only takes precedence over x-read-only', async () => {
    const body = await callListTools({
      'X-Neon-Read-Only': 'false',
      'x-read-only': 'true',
    });
    expect(body.readOnly).toBe(false);
    expect(body.tools).toHaveLength(29);
  });

  it('OPTIONS returns expected CORS allow-headers', () => {
    const res = OPTIONS();
    const allowed = res.headers.get('Access-Control-Allow-Headers') ?? '';
    expect(allowed).toBe(
      'X-Neon-Scopes, X-Neon-Project-Id, X-Neon-Read-Only, x-read-only',
    );
  });

  it('returns valid responses across repeated mixed-header requests', async () => {
    const headerSets: Record<string, string>[] = [
      {},
      { 'X-Neon-Project-Id': 'proj-123' },
      { 'X-Neon-Scopes': 'querying' },
      { 'X-Neon-Read-Only': 'true' },
      {
        'X-Neon-Project-Id': 'proj-123',
        'X-Neon-Scopes': 'querying,schema',
      },
      { 'X-Neon-Scopes': 'not-a-real-scope' },
    ];

    const runs = Array.from({ length: 200 }, (_, i) =>
      callListTools(headerSets[i % headerSets.length]),
    );

    const bodies = await Promise.all(runs);
    expect(bodies).toHaveLength(200);

    for (const body of bodies) {
      expect(Array.isArray(body.tools)).toBe(true);
      expect(typeof body.readOnly).toBe('boolean');
      expect(body.grant).toBeDefined();
      expect(body.grant.projectId === null || typeof body.grant.projectId === 'string').toBe(
        true,
      );
      expect(body.grant.scopes === null || Array.isArray(body.grant.scopes)).toBe(
        true,
      );
    }
  });
});
