/**
 * Integration tests for the /api/list-tools endpoint.
 *
 * These tests import the GET handler directly from the Next.js route and call
 * it with different X-Neon-* headers. No mocking, no server startup, no database.
 *
 * This exercises the full pipeline:
 *   Request headers -> resolveGrantFromHeaders -> isReadOnly -> getAvailableTools -> JSON response
 */

import { describe, it, expect } from 'vitest';
import { GET } from '../../app/api/list-tools/route';

type ListToolsResponse = {
  grant: {
    preset: string;
    projectId: string | null;
    scopes: string[] | null;
    protectedBranches: string[] | null;
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

/**
 * Helper to call the GET handler with optional headers and parse the response.
 */
async function callListTools(
  headers: Record<string, string> = {},
): Promise<ListToolsResponse> {
  const req = new Request('http://localhost/api/list-tools', {
    headers,
  });
  const res = await GET(req);
  return res.json() as Promise<ListToolsResponse>;
}

describe('/api/list-tools endpoint', () => {
  it('returns 28 tools with no headers (full_access default)', async () => {
    const body = await callListTools();

    expect(body.tools).toHaveLength(28);
    expect(body.readOnly).toBe(false);
    expect(body.grant.preset).toBe('full_access');
    expect(body.grant.projectId).toBeNull();
    expect(body.warnings).toBeUndefined();
  });

  it('returns 17 tools for production_use preset', async () => {
    const body = await callListTools({
      'X-Neon-Preset': 'production_use',
    });

    expect(body.tools).toHaveLength(17);
    expect(body.readOnly).toBe(true);
    expect(body.grant.preset).toBe('production_use');
  });

  it('returns 26 tools for local_development preset', async () => {
    const body = await callListTools({
      'X-Neon-Preset': 'local_development',
    });

    expect(body.tools).toHaveLength(26);
    expect(body.readOnly).toBe(false);
    expect(body.grant.preset).toBe('local_development');
  });

  it('returns 5 tools for X-Neon-Scopes: schema,docs (custom preset)', async () => {
    const body = await callListTools({
      'X-Neon-Scopes': 'schema,docs',
    });

    expect(body.tools).toHaveLength(5);
    expect(body.grant.preset).toBe('custom');
    expect(body.grant.scopes).toEqual(
      expect.arrayContaining(['schema', 'docs']),
    );
  });

  it('returns 2 tools for all-invalid scopes with a warning', async () => {
    const body = await callListTools({
      'X-Neon-Scopes': 'foo,bar,baz',
    });

    expect(body.tools).toHaveLength(2);
    expect(body.grant.preset).toBe('custom');
    // Invalid scopes are filtered out
    expect(body.grant.scopes).toEqual([]);

    // Only always-available tools remain
    const names = body.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['search', 'fetch']));

    // Should warn that no valid scopes are set
    expect(body.warnings).toBeDefined();
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings![0]).toContain('no valid scope categories');
  });

  it('returns 23 tools for project-scoped mode', async () => {
    const body = await callListTools({
      'X-Neon-Project-Id': 'proj-123',
    });

    expect(body.tools).toHaveLength(23);
    expect(body.grant.projectId).toBe('proj-123');

    // Project-agnostic tools should be hidden
    const names = body.tools.map((t) => t.name);
    expect(names).not.toContain('list_projects');
    expect(names).not.toContain('list_organizations');
    expect(names).not.toContain('create_project');
    expect(names).not.toContain('delete_project');
  });

  it('returns 17 tools for X-Neon-Read-Only: true', async () => {
    const body = await callListTools({
      'X-Neon-Read-Only': 'true',
    });

    expect(body.tools).toHaveLength(17);
    expect(body.readOnly).toBe(true);

    // All returned tools should be readOnlySafe
    for (const tool of body.tools) {
      expect(tool.readOnlySafe).toBe(true);
    }
  });

  it('includes warnings for production_use + readOnly=false', async () => {
    const body = await callListTools({
      'X-Neon-Preset': 'production_use',
      'X-Neon-Read-Only': 'false',
    });

    expect(body.tools).toHaveLength(17);
    // readOnly is false because the explicit header overrides the preset
    expect(body.readOnly).toBe(false);
    expect(body.warnings).toBeDefined();
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings![0]).toContain('⚠️ Warning:');
  });

  it('scopes override preset to custom', async () => {
    const body = await callListTools({
      'X-Neon-Preset': 'production_use',
      'X-Neon-Scopes': 'querying',
    });

    // Scopes override preset to custom
    expect(body.grant.preset).toBe('custom');
    expect(body.tools).toHaveLength(7);
  });

  it('kitchen sink: all headers combined', async () => {
    const body = await callListTools({
      'X-Neon-Preset': 'local_development',
      'X-Neon-Scopes': 'querying',
      'X-Neon-Project-Id': 'proj-abc',
      'X-Neon-Read-Only': 'true',
      'X-Neon-Protect-Production': 'true',
    });

    // Scopes override preset to custom
    expect(body.grant.preset).toBe('custom');
    expect(body.grant.projectId).toBe('proj-abc');
    expect(body.readOnly).toBe(true);
    expect(body.grant.protectedBranches).toEqual([
      'main', 'master', 'prod', 'production',
    ]);

    // custom (querying) + project-scoped + read-only
    expect(body.tools).toHaveLength(5);
  });

  it('legacy x-read-only header is supported', async () => {
    const body = await callListTools({
      'x-read-only': 'true',
    });

    expect(body.tools).toHaveLength(17);
    expect(body.readOnly).toBe(true);
  });

  it('X-Neon-Read-Only takes precedence over x-read-only', async () => {
    const body = await callListTools({
      'X-Neon-Read-Only': 'false',
      'x-read-only': 'true',
    });

    // X-Neon-Read-Only (false) should win
    expect(body.readOnly).toBe(false);
    expect(body.tools).toHaveLength(28);
  });

  it('protect-production sets protectedBranches', async () => {
    const body = await callListTools({
      'X-Neon-Protect-Production': 'true',
    });

    expect(body.grant.protectedBranches).toEqual([
      'main', 'master', 'prod', 'production',
    ]);
    // Branch protection does not change tool count (runtime enforcement only)
    expect(body.tools).toHaveLength(28);
  });

  it('protect-production accepts custom branch names', async () => {
    const body = await callListTools({
      'X-Neon-Protect-Production': 'staging,release',
    });

    expect(body.grant.protectedBranches).toEqual(['staging', 'release']);
  });

  it('returns correct tool metadata in response', async () => {
    const body = await callListTools();
    const searchTool = body.tools.find((t) => t.name === 'search');

    expect(searchTool).toBeDefined();
    expect(searchTool!.title).toBeTruthy();
    expect(searchTool!.description).toBeTruthy();
    expect(typeof searchTool!.readOnlySafe).toBe('boolean');
  });

  // ----- Gap fills from temp.md cross-reference -----

  // Edge case: invalid preset silently falls back to full_access
  it('invalid preset falls back to full_access (28 tools)', async () => {
    const body = await callListTools({
      'X-Neon-Preset': 'bogus_preset',
    });

    expect(body.tools).toHaveLength(28);
    expect(body.grant.preset).toBe('full_access');
    expect(body.readOnly).toBe(false);
  });

  // Edge case #3: empty X-Neon-Scopes header vs missing header
  // Empty string -> null -> falls through to preset logic -> 28 tools (NOT 2)
  it('empty X-Neon-Scopes header is treated as missing (28 tools, not 2)', async () => {
    const body = await callListTools({
      'X-Neon-Scopes': '',
    });

    // Empty string returns null scopes, so preset logic applies (full_access)
    expect(body.tools).toHaveLength(28);
    expect(body.grant.preset).toBe('full_access');
    expect(body.grant.scopes).toBeNull();
  });

  // Edge case #2: local_development + project = same result as full_access + project
  it('local_development + project-scoped = same as full_access + project-scoped (23 tools)', async () => {
    const localDev = await callListTools({
      'X-Neon-Preset': 'local_development',
      'X-Neon-Project-Id': 'proj-123',
    });
    const fullAccess = await callListTools({
      'X-Neon-Preset': 'full_access',
      'X-Neon-Project-Id': 'proj-123',
    });

    expect(localDev.tools).toHaveLength(23);
    expect(fullAccess.tools).toHaveLength(23);
    // Same tool names
    const localDevNames = localDev.tools.map((t) => t.name).sort();
    const fullAccessNames = fullAccess.tools.map((t) => t.name).sort();
    expect(localDevNames).toEqual(fullAccessNames);
  });

  // Custom scopes + project-scoped
  it('querying,schema + project-scoped -> 9 tools', async () => {
    const body = await callListTools({
      'X-Neon-Scopes': 'querying,schema',
      'X-Neon-Project-Id': 'proj-abc',
    });

    expect(body.tools).toHaveLength(9);
    expect(body.grant.preset).toBe('custom');
    expect(body.grant.projectId).toBe('proj-abc');
  });

  // X-Neon-Protect-Production: false -> no protection
  it('protect-production false returns null protectedBranches', async () => {
    const body = await callListTools({
      'X-Neon-Protect-Production': 'false',
    });

    expect(body.grant.protectedBranches).toBeNull();
    expect(body.tools).toHaveLength(28);
  });

  // Edge case #4: scopes override preset AND reset readOnly
  // production_use normally sets readOnly=true, but scopes override preset to custom
  // which does NOT auto-set readOnly
  it('scopes override production_use preset AND reset readOnly to false', async () => {
    const body = await callListTools({
      'X-Neon-Preset': 'production_use',
      'X-Neon-Scopes': 'querying',
    });

    expect(body.grant.preset).toBe('custom');
    // readOnly should be false because custom preset does NOT imply read-only
    expect(body.readOnly).toBe(false);
    expect(body.tools).toHaveLength(7);
    // Verify write tools ARE included (since readOnly is false)
    const names = body.tools.map((t) => t.name);
    expect(names).toContain('prepare_database_migration');
    expect(names).toContain('complete_database_migration');
  });

  // Explicit full_access + read-only override
  it('X-Neon-Read-Only: true + explicit full_access preset -> 17 tools', async () => {
    const body = await callListTools({
      'X-Neon-Preset': 'full_access',
      'X-Neon-Read-Only': 'true',
    });

    expect(body.tools).toHaveLength(17);
    expect(body.readOnly).toBe(true);
    expect(body.grant.preset).toBe('full_access');
  });

  // Additional scope combos from temp.md
  it('X-Neon-Scopes: performance -> 6 tools', async () => {
    const body = await callListTools({
      'X-Neon-Scopes': 'performance',
    });

    expect(body.tools).toHaveLength(6);
    expect(body.grant.preset).toBe('custom');
    const names = body.tools.map((t) => t.name);
    expect(names).toContain('explain_sql_statement');
    expect(names).toContain('prepare_query_tuning');
    expect(names).toContain('complete_query_tuning');
    expect(names).toContain('list_slow_queries');
    expect(names).toContain('search');
    expect(names).toContain('fetch');
  });

  it('X-Neon-Scopes: neon_auth -> 4 tools', async () => {
    const body = await callListTools({
      'X-Neon-Scopes': 'neon_auth',
    });

    expect(body.tools).toHaveLength(4);
    expect(body.grant.preset).toBe('custom');
    const names = body.tools.map((t) => t.name);
    expect(names).toContain('provision_neon_auth');
    expect(names).toContain('provision_neon_data_api');
    expect(names).toContain('search');
    expect(names).toContain('fetch');
  });

  it('X-Neon-Scopes: projects,branches -> 14 tools', async () => {
    const body = await callListTools({
      'X-Neon-Scopes': 'projects,branches',
    });

    expect(body.tools).toHaveLength(14);
    expect(body.grant.preset).toBe('custom');
  });

  // production_use + project-scoped (through the endpoint)
  it('production_use + project-scoped -> 14 tools', async () => {
    const body = await callListTools({
      'X-Neon-Preset': 'production_use',
      'X-Neon-Project-Id': 'proj-123',
    });

    expect(body.tools).toHaveLength(14);
    expect(body.readOnly).toBe(true);
    expect(body.grant.preset).toBe('production_use');
    expect(body.grant.projectId).toBe('proj-123');
  });
});
