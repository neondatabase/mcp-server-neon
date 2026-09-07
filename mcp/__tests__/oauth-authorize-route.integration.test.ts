import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../../app/api/authorize/route';
import { model } from '../oauth/model';
import { upstreamAuth } from '../../lib/oauth/client';

vi.mock('../oauth/model', () => ({
  model: {
    getClient: vi.fn(),
    getClientRegisterHeaders: vi.fn(),
    saveClientAuthContext: vi.fn(),
  },
}));

vi.mock('../../lib/oauth/client', () => ({
  upstreamAuth: vi.fn(async () => new URL('https://oauth.example/authorize')),
}));

const VALID_CLIENT = {
  id: 'client-123',
  client_name: 'Authorize Test Client',
  redirect_uris: ['http://127.0.0.1:55667/callback'],
  response_types: ['code'],
  grant_types: ['authorization_code', 'refresh_token'],
  tokenEndpointAuthMethod: 'none',
  secret: '',
};

function buildAuthorizeRequest(
  headers: Record<string, string> = {},
  scope = 'read write',
  extraParams: Record<string, string> = {},
): NextRequest {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: VALID_CLIENT.id,
    redirect_uri: VALID_CLIENT.redirect_uris[0],
    scope,
    state: 'test-state',
    ...extraParams,
  });

  return new NextRequest(
    `http://localhost/api/authorize?${params.toString()}`,
    {
      method: 'GET',
      headers,
    },
  );
}

function extractWriteCheckbox(html: string): string {
  const match = html.match(
    /<input[\s\S]*?name="scopes"[\s\S]*?value="write"[\s\S]*?class="scope-checkbox"[\s\S]*?\/>/,
  );
  expect(match).toBeTruthy();
  return match![0];
}

function extractEncodedState(html: string): string {
  const match = html.match(/<input type="hidden" name="state" value="([^"]+)"/);
  expect(match).toBeTruthy();
  return match![1];
}

function decodeState(html: string): Record<string, unknown> {
  return JSON.parse(atob(extractEncodedState(html)));
}

function decodeUpstreamAuthState(): Record<string, unknown> {
  const encoded = vi.mocked(upstreamAuth).mock.calls.at(-1)?.[0];
  if (typeof encoded !== 'string') {
    throw new Error('expected upstreamAuth to be called with encoded state');
  }
  return JSON.parse(atob(encoded)) as Record<string, unknown>;
}

function buildApproveRequest(
  requestedScopes: string[],
  selectedScopes: string[],
): NextRequest {
  const state = btoa(
    JSON.stringify({
      responseType: 'code',
      clientId: VALID_CLIENT.id,
      redirectUri: VALID_CLIENT.redirect_uris[0],
      scope: requestedScopes,
      state: 'test-state',
    }),
  );
  const form = new FormData();
  form.set('state', state);
  for (const scope of selectedScopes) {
    form.append('scopes', scope);
  }
  return new NextRequest('http://localhost/api/authorize', {
    method: 'POST',
    body: form,
  });
}

describe('/api/authorize route integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(model.getClient).mockResolvedValue(
      VALID_CLIENT as unknown as Awaited<ReturnType<typeof model.getClient>>,
    );
    vi.mocked(model.getClientRegisterHeaders).mockResolvedValue(undefined);
    vi.mocked(model.saveClientAuthContext).mockResolvedValue({
      grant: { projectId: null, scopes: null },
      scope: ['read', 'write'],
      readOnly: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never);
  });

  it('defaults Full access to checked when no read-only header is set', async () => {
    const response = await GET(buildAuthorizeRequest());
    const html = await response.text();
    const writeCheckbox = extractWriteCheckbox(html);

    expect(response.status).toBe(200);
    expect(writeCheckbox).toContain('checked');
  });

  it('defaults Full access to unchecked when x-read-only is true', async () => {
    const response = await GET(
      buildAuthorizeRequest({
        'x-read-only': 'true',
      }),
    );
    const html = await response.text();
    const writeCheckbox = extractWriteCheckbox(html);

    expect(response.status).toBe(200);
    expect(writeCheckbox).not.toContain('checked');
    expect(html).not.toContain(
      'This connection requested read-only access. You can allow writes for this authorization.',
    );
  });

  it('defaults Full access to unchecked when readonly query param is true', async () => {
    const response = await GET(
      buildAuthorizeRequest({}, 'read write', {
        readonly: 'true',
      }),
    );
    const html = await response.text();
    const writeCheckbox = extractWriteCheckbox(html);

    expect(response.status).toBe(200);
    expect(writeCheckbox).not.toContain('checked');
    expect(html).toContain(
      'This connection requested read-only access. You can allow writes for this authorization.',
    );
  });

  it('defaults Full access to unchecked when readonly=true is passed via resource query', async () => {
    const response = await GET(
      buildAuthorizeRequest({}, 'read write', {
        resource: 'https://mcp.neon.tech/mcp?readonly=true',
      }),
    );
    const html = await response.text();
    const writeCheckbox = extractWriteCheckbox(html);

    expect(response.status).toBe(200);
    expect(writeCheckbox).not.toContain('checked');
    expect(html).toContain(
      'This connection requested read-only access. You can allow writes for this authorization.',
    );
  });

  it('defaults Full access to unchecked from saved register x-read-only header', async () => {
    vi.mocked(model.getClientRegisterHeaders).mockResolvedValue({
      headers: {
        'x-read-only': 'true',
      },
      createdAt: Date.now(),
    });

    const response = await GET(buildAuthorizeRequest());
    const html = await response.text();
    const writeCheckbox = extractWriteCheckbox(html);

    expect(response.status).toBe(200);
    expect(writeCheckbox).not.toContain('checked');
    expect(html).not.toContain(
      'This connection requested read-only access. You can allow writes for this authorization.',
    );
  });

  it('does not embed grant context in the upstream OAuth state parameter', async () => {
    const response = await GET(buildAuthorizeRequest());
    const html = await response.text();
    const state = decodeState(html);

    expect(response.status).toBe(200);
    expect(state).not.toHaveProperty('grant');
  });

  it('preserves resource parameter in encoded state for callback grant resolution', async () => {
    const resource =
      'https://mcp.neon.tech/mcp?projectId=proj-123&category=schema';
    const response = await GET(
      buildAuthorizeRequest({}, 'read write', { resource }),
    );
    const html = await response.text();
    const state = decodeState(html);

    expect(response.status).toBe(200);
    expect(state).toHaveProperty('resource', resource);
  });

  it('persists parsed resource grant context in client auth context KV', async () => {
    const resource =
      'https://mcp.neon.tech/mcp?projectId=proj-123&category=querying,schema';
    const response = await GET(
      buildAuthorizeRequest({}, 'read write', { resource }),
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(model.saveClientAuthContext)).toHaveBeenCalledWith(
      VALID_CLIENT.id,
      expect.objectContaining({
        grant: {
          projectId: 'proj-123',
          scopes: ['querying', 'schema'],
        },
      }),
    );
  });

  it('returns invalid_target when resource parameter is malformed', async () => {
    const response = await GET(
      buildAuthorizeRequest({}, 'read write', {
        resource: '/mcp?category=schema',
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_target',
      error_description: 'Invalid resource parameter',
    });
  });

  it('returns invalid_target when resource parameter is not https', async () => {
    const response = await GET(
      buildAuthorizeRequest({}, 'read write', {
        resource: 'http://mcp.neon.tech/mcp?category=schema',
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_target',
      error_description: 'Invalid resource parameter',
    });
  });

  it('renders consent HTML on GET and does not redirect to upstream OAuth', async () => {
    const resource =
      'https://mcp.neon.tech/mcp?projectId=proj-123&category=querying';
    const response = await GET(
      buildAuthorizeRequest({}, 'read write', { resource }),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('scope-checkbox');
    expect(upstreamAuth).not.toHaveBeenCalled();
  });

  it('keeps requested * on the granted scope when write is approved', async () => {
    const response = await GET(buildAuthorizeRequest({}, 'read write *'));
    const state = decodeState(await response.text());

    expect(response.status).toBe(200);
    expect(model.saveClientAuthContext).toHaveBeenCalledWith(
      VALID_CLIENT.id,
      expect.objectContaining({
        scope: ['read', 'write', '*'],
        readOnly: false,
      }),
    );
    expect(state.scope).toEqual(['read', 'write', '*']);
  });

  it('drops * when the request is read-only', async () => {
    const response = await GET(
      buildAuthorizeRequest({}, 'read write *', {
        readonly: 'true',
      }),
    );

    expect(response.status).toBe(200);
    expect(model.saveClientAuthContext).toHaveBeenCalledWith(
      VALID_CLIENT.id,
      expect.objectContaining({
        scope: ['read'],
        readOnly: true,
      }),
    );
  });

  it('keeps requested * on POST when Full access stays checked', async () => {
    const response = await POST(
      buildApproveRequest(['read', 'write', '*'], ['read', 'write']),
    );

    expect(response.status).toBe(307);
    expect(model.saveClientAuthContext).toHaveBeenCalledWith(
      VALID_CLIENT.id,
      expect.objectContaining({
        scope: ['read', 'write', '*'],
        readOnly: false,
      }),
    );
    expect(decodeUpstreamAuthState().scope).toEqual(['read', 'write', '*']);
  });

  it('does not issue * on POST when Full access is unchecked', async () => {
    const response = await POST(
      buildApproveRequest(['read', 'write', '*'], ['read']),
    );

    expect(response.status).toBe(307);
    expect(model.saveClientAuthContext).toHaveBeenCalledWith(
      VALID_CLIENT.id,
      expect.objectContaining({
        scope: ['read'],
        readOnly: true,
      }),
    );
    expect(decodeUpstreamAuthState().scope).toEqual(['read']);
  });

  it('shows the resource project and categories on the consent page', async () => {
    const resource =
      'https://mcp.neon.tech/mcp?projectId=proj-123&category=querying,schema';
    const response = await GET(
      buildAuthorizeRequest({}, 'read write', { resource }),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('proj-123');
    expect(html).toContain('Querying');
    expect(html).toContain('Schema');
    expect(html).toContain('Connection access');
    expect(html).not.toContain('Search and Fetch stay available');
  });

  it('shows unrestricted project and categories when resource has no query', async () => {
    const response = await GET(
      buildAuthorizeRequest({}, 'read write', {
        resource: 'https://mcp.neon.tech/mcp',
      }),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('All projects you can access');
    expect(html).toContain('All categories');
  });

  it('keeps a mixed valid/unknown category list on the page and in KV', async () => {
    const resource =
      'https://mcp.neon.tech/mcp?category=querying,not-a-category';
    const response = await GET(
      buildAuthorizeRequest({}, 'read write', { resource }),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Querying');
    expect(html).toContain('Ignored category values: not-a-category');
    expect(vi.mocked(model.saveClientAuthContext)).toHaveBeenCalledWith(
      VALID_CLIENT.id,
      expect.objectContaining({
        grant: {
          projectId: null,
          scopes: ['querying'],
          unknownCategories: ['not-a-category'],
        },
      }),
    );
  });

  it('POST from the rendered form keeps the resource grant and redirects upstream', async () => {
    const resource =
      'https://mcp.neon.tech/mcp?projectId=proj-123&category=querying';
    const getResponse = await GET(
      buildAuthorizeRequest({}, 'read write', { resource }),
    );
    const html = await getResponse.text();
    const state = extractEncodedState(html);

    const form = new FormData();
    form.set('state', state);
    form.append('scopes', 'read');
    form.append('scopes', 'write');
    const postResponse = await POST(
      new NextRequest('http://localhost/api/authorize', {
        method: 'POST',
        body: form,
      }),
    );

    expect(getResponse.status).toBe(200);
    expect(postResponse.status).toBe(307);
    expect(vi.mocked(model.saveClientAuthContext)).toHaveBeenLastCalledWith(
      VALID_CLIENT.id,
      expect.objectContaining({
        grant: {
          projectId: 'proj-123',
          scopes: ['querying'],
        },
        scope: ['read', 'write'],
        readOnly: false,
      }),
    );
    expect(decodeUpstreamAuthState()).toMatchObject({
      resource,
      scope: ['read', 'write'],
      redirectUri: VALID_CLIENT.redirect_uris[0],
    });
  });

  it('POST from the rendered form can approve read-only without dropping the resource', async () => {
    const resource =
      'https://mcp.neon.tech/mcp?projectId=proj-123&category=querying';
    const getResponse = await GET(
      buildAuthorizeRequest({}, 'read write', { resource }),
    );
    const state = extractEncodedState(await getResponse.text());

    const form = new FormData();
    form.set('state', state);
    form.append('scopes', 'read');
    const postResponse = await POST(
      new NextRequest('http://localhost/api/authorize', {
        method: 'POST',
        body: form,
      }),
    );

    expect(postResponse.status).toBe(307);
    expect(vi.mocked(model.saveClientAuthContext)).toHaveBeenLastCalledWith(
      VALID_CLIENT.id,
      expect.objectContaining({
        grant: {
          projectId: 'proj-123',
          scopes: ['querying'],
        },
        scope: ['read'],
        readOnly: true,
      }),
    );
    expect(decodeUpstreamAuthState()).toMatchObject({
      resource,
      scope: ['read'],
    });
  });
});
