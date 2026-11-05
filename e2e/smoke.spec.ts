import { test, expect } from '@playwright/test';
import serverJson from '../server.json' with { type: 'json' };

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
    expect(body.client_id_metadata_document_supported).toBe(true);
    expect(body.scopes_supported).toEqual(['read', 'write']);
    expect(body.code_challenge_methods_supported).toContain('S256');
    expect(body.authorization_response_iss_parameter_supported).toBe(true);
  });

  test('GET /.well-known/oauth-protected-resource returns resource metadata', async ({
    request,
  }) => {
    const response = await request.get('/.well-known/oauth-protected-resource');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.resource).toMatch(/^https:\/\//);
    expect(body.resource).not.toContain('/mcp');
    expect(body.authorization_servers).toEqual([new URL(body.resource).origin]);
  });

  test('GET path-derived protected resource metadata keeps exact path+query identity', async ({
    request,
  }) => {
    const response = await request.get(
      '/.well-known/oauth-protected-resource/mcp?readonly=true',
    );
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.resource).toMatch(/^https:\/\//);
    expect(body.resource.endsWith('/mcp?readonly=true')).toBeTruthy();
    expect(body.authorization_servers).toEqual([new URL(body.resource).origin]);
  });

  for (const { path, contentType } of [
    {
      path: '/mcp/server-card',
      contentType: 'application/mcp-server-card+json',
    },
    { path: '/.well-known/mcp.json', contentType: 'application/json' },
  ]) {
    test(`GET ${path} returns the public Server Card`, async ({ request }) => {
      const response = await request.get(path);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toBe(contentType);
      expect(response.headers()['access-control-allow-origin']).toBe('*');

      const card = await response.json();
      expect(card).toMatchObject({
        $schema:
          'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
        name: serverJson.name,
        version: serverJson.version,
        title: serverJson.title,
        description: serverJson.description,
        websiteUrl: serverJson.websiteUrl,
        repository: serverJson.repository,
        icons: serverJson.icons,
      });
      expect(card.remotes).toEqual([
        {
          type: 'streamable-http',
          url: expect.stringMatching(/\/mcp$/),
          headers: serverJson.remotes[0].headers,
        },
      ]);
    });
  }

  for (const path of [
    '/mcp/server-card',
    '/.well-known/mcp.json',
    '/.well-known/ai-catalog.json',
  ]) {
    test(`OPTIONS ${path} allows a cross-origin conditional GET`, async ({
      request,
    }) => {
      const response = await request.fetch(path, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://client.example',
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'content-type, if-none-match',
        },
      });
      expect(response.status()).toBe(204);
      expect(response.headers()).toMatchObject({
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET',
        'access-control-allow-headers': 'Content-Type, If-None-Match',
      });
    });
  }

  test('GET /.well-known/ai-catalog.json points at the Server Card', async ({
    request,
  }) => {
    const response = await request.get('/.well-known/ai-catalog.json');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe(
      'application/ai-catalog+json',
    );

    const catalog = await response.json();
    expect(catalog.specVersion).toBe('1.0');
    expect(catalog.entries).toEqual([
      {
        identifier: 'urn:air:neon.com:mcp:mcp',
        type: 'application/mcp-server-card+json',
        url: expect.stringMatching(/\/mcp\/server-card$/),
      },
    ]);

    const card = await request.get(new URL(catalog.entries[0].url).pathname);
    expect(card.status()).toBe(200);
  });

  test('/ redirects to Neon docs', async ({ request }) => {
    const response = await request.get('/', { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    expect(response.headers()['location']).toBe(
      'https://neon.com/docs/ai/neon-mcp-server',
    );
  });

  test('GET /sse returns 410 through the rewrite', async ({ request }) => {
    const response = await request.get('/sse');
    expect(response.status()).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      error: 'transport_gone',
    });
  });

  test('POST /message returns 410 through the rewrite', async ({ request }) => {
    const response = await request.post('/message');
    expect(response.status()).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      error: 'transport_gone',
    });
  });
});
