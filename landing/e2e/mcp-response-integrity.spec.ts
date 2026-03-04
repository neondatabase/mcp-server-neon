import { test, expect } from '@playwright/test';

test.describe('MCP runtime response integrity regression', () => {
  test('non-MCP API routes keep returning valid responses after MCP traffic', async ({
    request,
  }) => {
    /**
     * Why this test exists:
     * - We previously saw an intermittent failure where API routes started failing with:
     *   "No response is returned from route handler..."
     * - The failure was reported to happen after MCP traffic had already touched the runtime.
     *
     * This test intentionally exercises MCP first, then validates regular API routes still
     * return valid HTTP responses and JSON bodies.
     */

    // Trigger MCP code paths first. Unauthorized is expected in this API-only test.
    for (let i = 0; i < 5; i += 1) {
      const mcpResponse = await request.get('/mcp');
      expect([401, 405]).toContain(mcpResponse.status());
    }

    // The list-tools route was our easiest reproducer for the no-response regression.
    const listTools = await request.get('/api/list-tools', {
      headers: { 'X-Neon-Project-Id': 'proj-regression-check' },
    });
    expect(listTools.status()).toBe(200);
    const listToolsBody = await listTools.json();
    expect(Array.isArray(listToolsBody.tools)).toBe(true);

    // Also verify a second non-MCP route to catch cross-route runtime corruption.
    const health = await request.get('/api/health');
    expect(health.status()).toBe(200);
    const healthBody = await health.json();
    expect(healthBody.status).toBe('ok');
  });
});
