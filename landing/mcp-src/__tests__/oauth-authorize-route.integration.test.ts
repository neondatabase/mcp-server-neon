import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// `lib/config` reads COOKIE_SECRET at module load time, so we must inject
// a fixed test value before any importer of the config module touches it.
// `vi.mock` hoists ahead of imports, so the secret has to be hoisted too.
const { TEST_COOKIE_SECRET } = vi.hoisted(() => ({
  TEST_COOKIE_SECRET: 'integration-test-cookie-secret',
}));
vi.mock('../../lib/config', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/config')>(
      '../../lib/config',
    );
  return { ...actual, COOKIE_SECRET: TEST_COOKIE_SECRET };
});

import { GET } from '../../app/api/authorize/route';
import { model } from '../oauth/model';
import { isClientAlreadyApproved } from '../../lib/oauth/cookies';
import { upstreamAuth } from '../../lib/oauth/client';
import { verifyAndDecodeState } from '../../lib/oauth/state';
import type { ConsentSignedPayload } from '../../app/oauth/consent/types';

vi.mock('../oauth/model', () => ({
  model: {
    getClient: vi.fn(),
    getClientRegisterHeaders: vi.fn(),
    saveClientAuthContext: vi.fn(),
    getClientAuthContext: vi.fn(),
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

function getRedirectLocation(response: Response): URL {
  expect([302, 303, 307].includes(response.status)).toBe(true);
  const loc = response.headers.get('location');
  expect(loc).toBeTruthy();
  return new URL(loc!);
}

async function decodeConsentState(
  response: Response,
): Promise<ConsentSignedPayload> {
  const url = getRedirectLocation(response);
  expect(url.pathname).toBe('/oauth/consent');
  const state = url.searchParams.get('state');
  expect(state).toBeTruthy();
  const decoded = await verifyAndDecodeState<ConsentSignedPayload>(
    state,
    TEST_COOKIE_SECRET,
  );
  expect(decoded).not.toBeNull();
  return decoded!;
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
    vi.mocked(model.getClientAuthContext).mockResolvedValue(undefined);
    vi.mocked(isClientAlreadyApproved).mockResolvedValue(false);
  });

  it('redirects to the consent page with a signed state envelope', async () => {
    const response = await GET(buildAuthorizeRequest());
    const location = getRedirectLocation(response);
    expect(location.pathname).toBe('/oauth/consent');
    expect(location.searchParams.get('state')).toBeTruthy();
  });

  it('signed state contains the parsed authorize request', async () => {
    const response = await GET(buildAuthorizeRequest());
    const payload = await decodeConsentState(response);
    expect(payload.authRequest.clientId).toBe(VALID_CLIENT.id);
    expect(payload.authRequest.redirectUri).toBe(VALID_CLIENT.redirect_uris[0]);
    expect(payload.authRequest.responseType).toBe('code');
    expect(payload.iat).toBeGreaterThan(0);
  });

  it('sets defaultReadOnly=false when no read-only signal is present', async () => {
    const response = await GET(buildAuthorizeRequest());
    const payload = await decodeConsentState(response);
    expect(payload.defaultReadOnly).toBe(false);
    expect(payload.requestedScope).toEqual(['read', 'write']);
  });

  it('sets defaultReadOnly=true when x-read-only header is true', async () => {
    const response = await GET(
      buildAuthorizeRequest({ 'x-read-only': 'true' }),
    );
    const payload = await decodeConsentState(response);
    expect(payload.defaultReadOnly).toBe(true);
    expect(payload.requestedScope).toEqual(['read']);
  });

  it('sets defaultReadOnly=true when readonly query param is true', async () => {
    const response = await GET(
      buildAuthorizeRequest({}, 'read write', { readonly: 'true' }),
    );
    const payload = await decodeConsentState(response);
    expect(payload.defaultReadOnly).toBe(true);
  });

  it('sets defaultReadOnly=true when readonly=true is on the resource URI', async () => {
    const response = await GET(
      buildAuthorizeRequest({}, 'read write', {
        resource: 'https://mcp.neon.tech/mcp?readonly=true',
      }),
    );
    const payload = await decodeConsentState(response);
    expect(payload.defaultReadOnly).toBe(true);
  });

  it('sets defaultReadOnly=true from saved register x-read-only header', async () => {
    vi.mocked(model.getClientRegisterHeaders).mockResolvedValue({
      headers: { 'x-read-only': 'true' },
      createdAt: Date.now(),
    });
    const response = await GET(buildAuthorizeRequest());
    const payload = await decodeConsentState(response);
    expect(payload.defaultReadOnly).toBe(true);
  });

  it('persists parsed resource grant context in client auth context KV', async () => {
    const resource =
      'https://mcp.neon.tech/mcp?projectId=proj-123&category=querying,schema';
    await GET(buildAuthorizeRequest({}, 'read write', { resource }));

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

  it('skips the consent page and forwards upstream when client is pre-approved with the same grant shape', async () => {
    vi.mocked(isClientAlreadyApproved).mockResolvedValue(true);
    vi.mocked(model.getClientAuthContext).mockResolvedValue({
      grant: { projectId: null, scopes: null },
      scope: ['read', 'write'],
      readOnly: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never);

    const response = await GET(buildAuthorizeRequest());

    expect(response.status).toBe(307);
    expect(upstreamAuth).toHaveBeenCalledWith(expect.any(String));
    const location = response.headers.get('location');
    expect(location).toBe('https://oauth.example/authorize');
  });

  it('re-shows the consent page when prior approval covered a different grant shape', async () => {
    vi.mocked(isClientAlreadyApproved).mockResolvedValue(true);
    vi.mocked(model.getClientAuthContext).mockResolvedValue({
      grant: { projectId: null, scopes: null },
      scope: ['read', 'write'],
      readOnly: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never);

    const response = await GET(
      buildAuthorizeRequest({}, 'read write', {
        resource:
          'https://mcp.neon.tech/mcp?projectId=proj-9&category=querying',
      }),
    );

    const location = getRedirectLocation(response);
    expect(location.pathname).toBe('/oauth/consent');
    expect(upstreamAuth).not.toHaveBeenCalled();
  });

  it('rejects with invalid_client when the registered client is missing', async () => {
    vi.mocked(model.getClient).mockResolvedValue(undefined);
    const response = await GET(buildAuthorizeRequest());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_client',
      error_description: 'Invalid client ID',
    });
  });

  it('rejects with invalid_request when redirect URI is not registered', async () => {
    const response = await GET(
      buildAuthorizeRequest({}, 'read write', {
        redirect_uri: 'https://attacker.example/callback',
      }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_request',
      error_description: 'Invalid redirect URI',
    });
  });
});
