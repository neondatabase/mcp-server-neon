/**
 * E2E tests for the /api/list-tools endpoint.
 *
 * These tests make real HTTP requests to the running Next.js server
 * to verify the access control header-based tool filtering pipeline
 * works end-to-end through Next.js routing.
 *
 * The /api/list-tools endpoint is stateless (no auth, no database),
 * so it only needs the Next.js dev server (handled by Playwright's webServer config).
 *
 * Uses Playwright's APIRequestContext (via the `request` fixture) for
 * API-only tests — no browser needed.
 */

import { test, expect } from '@playwright/test';

test.describe('/api/list-tools endpoint', () => {
  test('returns all 29 tools with no headers (full_access default)', async ({
    request,
  }) => {
    const response = await request.get('/api/list-tools');
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.tools).toHaveLength(29);
    expect(body.readOnly).toBe(false);
    expect(body.grant.preset).toBe('full_access');
    expect(body.grant.projectId).toBeNull();
    expect(body.warnings).toBeUndefined();
  });

  test('returns 18 tools for production_use preset', async ({ request }) => {
    const response = await request.get('/api/list-tools', {
      headers: { 'X-Neon-Preset': 'production_use' },
    });
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.tools).toHaveLength(18);
    expect(body.readOnly).toBe(true);
    expect(body.grant.preset).toBe('production_use');
  });

  test('returns 27 tools for local_development preset', async ({ request }) => {
    const response = await request.get('/api/list-tools', {
      headers: { 'X-Neon-Preset': 'local_development' },
    });
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.tools).toHaveLength(27);
    expect(body.readOnly).toBe(false);
    expect(body.grant.preset).toBe('local_development');
  });

  test('returns 6 tools for X-Neon-Scopes: querying', async ({ request }) => {
    const response = await request.get('/api/list-tools', {
      headers: { 'X-Neon-Scopes': 'querying' },
    });
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.tools).toHaveLength(6);
    expect(body.grant.preset).toBe('custom');
  });

  test('returns 24 tools for project-scoped mode', async ({ request }) => {
    const response = await request.get('/api/list-tools', {
      headers: { 'X-Neon-Project-Id': 'proj-123' },
    });
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.tools).toHaveLength(24);
    expect(body.grant.projectId).toBe('proj-123');

    // Project-agnostic tools should be hidden
    const names = body.tools.map((t: { name: string }) => t.name);
    expect(names).not.toContain('list_projects');
    expect(names).not.toContain('list_organizations');
    expect(names).not.toContain('create_project');
    expect(names).not.toContain('delete_project');
  });

  test('returns 18 tools for X-Neon-Read-Only: true', async ({ request }) => {
    const response = await request.get('/api/list-tools', {
      headers: { 'X-Neon-Read-Only': 'true' },
    });
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.tools).toHaveLength(18);
    expect(body.readOnly).toBe(true);

    // All returned tools should be readOnlySafe
    for (const tool of body.tools) {
      expect(tool.readOnlySafe).toBe(true);
    }
  });

  test('includes warnings for production_use + readOnly=false', async ({
    request,
  }) => {
    const response = await request.get('/api/list-tools', {
      headers: {
        'X-Neon-Preset': 'production_use',
        'X-Neon-Read-Only': 'false',
      },
    });
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.tools).toHaveLength(18);
    expect(body.readOnly).toBe(false);
    expect(body.warnings).toBeDefined();
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0]).toContain('⚠️ Warning:');
  });

  test('CORS headers are present on response', async ({ request }) => {
    const response = await request.get('/api/list-tools');
    expect(response.ok()).toBeTruthy();

    expect(response.headers()['access-control-allow-origin']).toBe('*');
    expect(response.headers()['access-control-allow-methods']).toContain('GET');
  });

  test('OPTIONS preflight returns 204 with CORS headers', async ({
    request,
  }) => {
    const response = await request.fetch('/api/list-tools', {
      method: 'OPTIONS',
    });

    expect(response.status()).toBe(204);
    expect(response.headers()['access-control-allow-origin']).toBe('*');
    expect(response.headers()['access-control-allow-headers']).toContain(
      'X-Neon-Preset',
    );
  });
});
