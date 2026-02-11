import { test, expect } from '@playwright/test';

test.describe('Smoke tests', () => {
  test('GET /api/health returns status ok', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.version).toBeDefined();
    expect(body.timestamp).toBeDefined();
  });

  test('GET /.well-known/oauth-authorization-server returns discovery metadata', async ({
    request,
  }) => {
    const response = await request.get(
      '/.well-known/oauth-authorization-server',
    );
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.authorization_endpoint).toContain('/api/authorize');
    expect(body.token_endpoint).toContain('/api/token');
    expect(body.registration_endpoint).toContain('/api/register');
    expect(body.scopes_supported).toEqual(
      expect.arrayContaining(['read', 'write']),
    );
    expect(body.code_challenge_methods_supported).toContain('S256');
  });

  test('GET /.well-known/oauth-protected-resource returns resource metadata', async ({
    request,
  }) => {
    const response = await request.get('/.well-known/oauth-protected-resource');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.resource).toBeDefined();
    expect(body.authorization_servers).toBeDefined();
  });

  test('/ redirects to Neon docs', async ({ request }) => {
    const response = await request.get('/', { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    expect(response.headers()['location']).toBe(
      'https://neon.tech/docs/ai/neon-mcp-server',
    );
  });
});
