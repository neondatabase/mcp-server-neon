import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../../app/api/authorize/route';
import { model } from '../oauth/model';
import { isClientAlreadyApproved } from '../../lib/oauth/cookies';
import { upstreamAuth } from '../../lib/oauth/client';

vi.mock('../oauth/model', () => ({
  model: {
    getClient: vi.fn(),
    getClientRegisterHeaders: vi.fn(),
    saveClientAuthContext: vi.fn(),
  },
}));

vi.mock('../../lib/oauth/cookies', () => ({
  isClientAlreadyApproved: vi.fn(),
  updateApprovedClientsCookie: vi.fn(),
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
    vi.mocked(isClientAlreadyApproved).mockResolvedValue(false);
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

  it('does not forward resource parameter to upstream OAuth when client is pre-approved', async () => {
    const resource =
      'https://mcp.neon.tech/mcp?projectId=proj-123&category=querying';
    vi.mocked(isClientAlreadyApproved).mockResolvedValue(true);

    const response = await GET(
      buildAuthorizeRequest({}, 'read write', { resource }),
    );

    expect(response.status).toBe(307);
    expect(upstreamAuth).toHaveBeenCalledWith(expect.any(String));
  });
});
