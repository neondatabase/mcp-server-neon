/**
 * E2E tests for the /api/list-tools endpoint.
 *
 * These tests make real HTTP requests to the running Next.js server
 * to verify the access control query-param-based tool filtering pipeline
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
  test('returns every tool with no params', async ({ request }) => {
    const response = await request.get('/api/list-tools');
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.tools.length).toBeGreaterThan(50);
    expect(body.readOnly).toBe(false);
    expect(body.grant.scopes).toBeNull();
    expect(body.grant.projectId).toBeNull();
    expect(body.warnings).toBeUndefined();
  });

  test('returns querying tools for category=querying', async ({ request }) => {
    const response = await request.get('/api/list-tools?category=querying');
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    const names = body.tools.map((t: { name: string }) => t.name);
    expect(names).toContain('run_sql');
    expect(names).not.toContain('create_project');
    expect(body.grant.scopes).toEqual(['querying']);
  });

  test('hides project-agnostic tools in project-scoped mode', async ({
    request,
  }) => {
    const response = await request.get('/api/list-tools?projectId=proj-123');
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.grant.projectId).toBe('proj-123');

    const names = body.tools.map((t: { name: string }) => t.name);
    expect(names).not.toContain('projects_list');
    expect(names).not.toContain('list_organizations');
    expect(names).not.toContain('create_project');
    expect(names).not.toContain('projects_delete');
    expect(names).not.toContain('search');
    expect(names).not.toContain('fetch');
    expect(names).toContain('projects_get');
  });

  test('returns readOnlySafe tools for readonly=true', async ({ request }) => {
    const response = await request.get('/api/list-tools?readonly=true');
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.readOnly).toBe(true);

    for (const tool of body.tools) {
      expect(tool.readOnlySafe).toBe(true);
    }

    expect(body.tools.map((tool: { name: string }) => tool.name)).not.toContain(
      'get_connection_string',
    );
  });

  test('includes warnings for invalid scope categories', async ({
    request,
  }) => {
    const response = await request.get(
      '/api/list-tools?category=not-a-real-scope',
    );
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.tools).toHaveLength(2);
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
      'x-read-only',
    );
  });
});
