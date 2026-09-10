import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../../app/api/authorize/route';
import { model } from '../oauth/model';
import { upstreamAuth } from '../../lib/oauth/client';
import { SERVER_HOST } from '../../lib/config';
import { authTransactions } from '../oauth/auth-transaction-store';
import { AUTH_RESTART_DESCRIPTION } from '../oauth/consent-html-headers';
import { SCOPE_CATEGORIES } from '../utils/grant-context';
import { ensureTestOauthDatabase } from './ensure-test-oauth-database';
import { neon } from '@neondatabase/serverless';

vi.mock('../oauth/model', () => ({
  model: {
    getClient: vi.fn(),
    getClientRegisterHeaders: vi.fn(),
  },
}));

vi.mock('../../lib/oauth/client', () => ({
  upstreamAuth: vi.fn(
    async (state: string) =>
      new URL(`https://oauth.example/authorize?state=${state}`),
  ),
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

  return new NextRequest(`${SERVER_HOST}/api/authorize?${params.toString()}`, {
    method: 'GET',
    headers,
  });
}

function extractState(html: string): string {
  const match = html.match(/<input type="hidden" name="state" value="([^"]+)"/);
  expect(match).toBeTruthy();
  return match![1];
}

function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

function appendAllCategories(form: FormData): void {
  for (const category of SCOPE_CATEGORIES) {
    form.append('category', category);
  }
}

async function postAuthorize({
  state,
  cookie,
  fields,
}: {
  state: string;
  cookie: string;
  fields: Array<[string, string]>;
}): Promise<Response> {
  const form = new FormData();
  form.set('state', state);
  for (const [name, value] of fields) {
    form.append(name, value);
  }
  return POST(
    new NextRequest(`${SERVER_HOST}/api/authorize`, {
      method: 'POST',
      headers: { cookie },
      body: form,
    }),
  );
}

describe('/api/authorize route integration', () => {
  beforeAll(async () => {
    await ensureTestOauthDatabase();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(model.getClient).mockResolvedValue(
      VALID_CLIENT as unknown as Awaited<ReturnType<typeof model.getClient>>,
    );
    vi.mocked(model.getClientRegisterHeaders).mockResolvedValue(undefined);
  });

  it('sets consent security headers', async () => {
    const response = await GET(buildAuthorizeRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Content-Security-Policy')).toBe(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(cookieHeader(response)).toContain('neon_mcp_at_');
    const setCookie = response.headers.getSetCookie().join('; ');
    const maxAge = setCookie.match(/Max-Age=(\d+)/i);
    expect(maxAge).toBeTruthy();
    expect(Number(maxAge![1])).toBeGreaterThan(1700);
    expect(Number(maxAge![1])).toBeLessThanOrEqual(1800);
  });

  it('renders editable consent with Allow writes checked by default', async () => {
    const response = await GET(buildAuthorizeRequest());
    const html = await response.text();
    expect(html).toContain('scope-checkbox');
    expect(html).toMatch(/class="scope-checkbox"[\s\S]*?checked/);
    expect(html).toContain('name="projectMode"');
    expect(upstreamAuth).not.toHaveBeenCalled();
  });

  it('defaults Allow writes to unchecked for registration x-read-only without locking it', async () => {
    vi.mocked(model.getClientRegisterHeaders).mockResolvedValue({
      headers: { 'x-read-only': 'true' },
      createdAt: Date.now(),
    });
    const response = await GET(buildAuthorizeRequest());
    const html = await response.text();
    const writeInput = html.match(
      /<input\s+type="checkbox"\s+name="scopes"\s+value="write"[\s\S]*?\/>/,
    )?.[0];
    expect(writeInput).toBeTruthy();
    expect(writeInput).not.toContain('checked');
  });

  it('keeps writes on a readonly=false resource despite registration x-read-only', async () => {
    vi.mocked(model.getClientRegisterHeaders).mockResolvedValue({
      headers: { 'x-read-only': 'true' },
      createdAt: Date.now(),
    });
    const resource = 'https://mcp.neon.tech/mcp?readonly=false';
    const getResponse = await GET(
      buildAuthorizeRequest({}, 'read write', { resource }),
    );
    const html = await getResponse.text();
    expect(html).toContain('Read and write');
    expect(html).not.toContain('class="scope-checkbox"');
    const state = extractState(html);
    const postResponse = await postAuthorize({
      state,
      cookie: cookieHeader(getResponse),
      fields: [['action', 'approve']],
    });
    const stored = await authTransactions.getById(state);
    expect(postResponse.status).toBe(303);
    if (stored?.status !== 'approved') {
      throw new Error('expected approved transaction');
    }
    expect(stored.approvedScopes).toEqual(['read', 'write']);
  });

  it('does not let authorize ?readonly=true reduce a writable confirmation resource', async () => {
    const resource = 'https://mcp.neon.tech/mcp?projectId=proj-123';
    const getResponse = await GET(
      buildAuthorizeRequest({}, 'read write', {
        resource,
        readonly: 'true',
      }),
    );
    const html = await getResponse.text();
    expect(html).toContain('Read and write');
    expect(html).not.toContain('class="scope-checkbox"');
    const state = extractState(html);
    const postResponse = await postAuthorize({
      state,
      cookie: cookieHeader(getResponse),
      fields: [['action', 'approve']],
    });
    const stored = await authTransactions.getById(state);
    expect(postResponse.status).toBe(303);
    if (stored?.status !== 'approved') {
      throw new Error('expected approved transaction');
    }
    expect(stored.approvedScopes).toEqual(['read', 'write']);
  });

  it('renders confirmation without editors for a parameterized resource', async () => {
    const resource =
      'https://mcp.neon.tech/mcp?projectId=proj-123&category=querying,schema&readonly=true';
    const response = await GET(
      buildAuthorizeRequest({}, 'read write', { resource }),
    );
    const html = await response.text();
    expect(html).toContain('proj-123');
    expect(html).toContain('Querying');
    expect(html).toContain('Schema');
    expect(html).toContain('Read-only');
    expect(html).not.toContain('class="scope-checkbox"');
    expect(html).not.toContain('name="projectMode"');
    expect(html).toContain(
      'To change these limits, update the connection URL and authorize again.',
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

  it('approves a fixed project/category writable grant', async () => {
    const resource =
      'https://mcp.neon.tech/mcp?projectId=proj-123&category=querying';
    const getResponse = await GET(
      buildAuthorizeRequest({}, 'read write', { resource }),
    );
    const html = await getResponse.text();
    const state = extractState(html);
    const postResponse = await postAuthorize({
      state,
      cookie: cookieHeader(getResponse),
      fields: [['action', 'approve']],
    });
    const stored = await authTransactions.getById(state);
    expect(postResponse.status).toBe(303);
    expect(stored?.status).toBe('approved');
    if (stored?.status !== 'approved') {
      throw new Error('expected approved transaction');
    }
    expect(stored.approvedGrant).toEqual({
      projectId: 'proj-123',
      scopes: ['querying'],
    });
    expect(stored.approvedScopes).toEqual(['read', 'write']);
    expect(vi.mocked(upstreamAuth).mock.calls.at(-1)?.[0]).toBe(state);
  });

  it('approves a fixed read-only resource as read even when the client asked for write', async () => {
    const resource =
      'https://mcp.neon.tech/mcp?projectId=proj-123&category=querying&readonly=true';
    const getResponse = await GET(
      buildAuthorizeRequest({}, 'read write', { resource }),
    );
    const state = extractState(await getResponse.text());
    const postResponse = await postAuthorize({
      state,
      cookie: cookieHeader(getResponse),
      fields: [['action', 'approve']],
    });
    const stored = await authTransactions.getById(state);
    expect(postResponse.status).toBe(303);
    if (stored?.status !== 'approved') {
      throw new Error('expected approved transaction');
    }
    expect(stored.approvedScopes).toEqual(['read']);
  });

  it('rejects confirmation tampering that adds write', async () => {
    const resource = 'https://mcp.neon.tech/mcp?readonly=true';
    const getResponse = await GET(
      buildAuthorizeRequest({}, 'read write', { resource }),
    );
    const state = extractState(await getResponse.text());
    const postResponse = await postAuthorize({
      state,
      cookie: cookieHeader(getResponse),
      fields: [
        ['action', 'approve'],
        ['scopes', 'write'],
      ],
    });
    expect(postResponse.status).toBe(400);
    await expect(postResponse.json()).resolves.toMatchObject({
      error: 'invalid_request',
    });
    const stored = await authTransactions.getById(state);
    expect(stored?.status).toBe('pending');
    expect(upstreamAuth).not.toHaveBeenCalled();
  });

  it('rejects a forged write when the OAuth request was read-only', async () => {
    const getResponse = await GET(buildAuthorizeRequest({}, 'read'));
    const state = extractState(await getResponse.text());
    const postResponse = await postAuthorize({
      state,
      cookie: cookieHeader(getResponse),
      fields: [
        ['action', 'approve'],
        ['projectMode', 'all'],
        ['scopes', 'read'],
        ['scopes', 'write'],
      ],
    });
    expect(postResponse.status).toBe(400);
    await expect(postResponse.json()).resolves.toEqual({
      error: 'invalid_scope',
      error_description: 'Write access was not requested',
    });
    expect(await authTransactions.getById(state)).toMatchObject({
      status: 'pending',
    });
  });

  it('persists an edited one-project subset with writes off', async () => {
    const getResponse = await GET(buildAuthorizeRequest());
    const state = extractState(await getResponse.text());
    const postResponse = await postAuthorize({
      state,
      cookie: cookieHeader(getResponse),
      fields: [
        ['action', 'approve'],
        ['projectMode', 'one'],
        ['projectId', 'proj-edited'],
        ['category', 'querying'],
        ['scopes', 'read'],
      ],
    });
    const stored = await authTransactions.getById(state);
    expect(postResponse.status).toBe(303);
    if (stored?.status !== 'approved') {
      throw new Error('expected approved transaction');
    }
    expect(stored.approvedGrant).toEqual({
      projectId: 'proj-edited',
      scopes: ['querying'],
    });
    expect(stored.approvedScopes).toEqual(['read']);
  });

  it('ignores a leftover project ID when All projects is selected', async () => {
    const getResponse = await GET(buildAuthorizeRequest());
    const state = extractState(await getResponse.text());
    const postResponse = await postAuthorize({
      state,
      cookie: cookieHeader(getResponse),
      fields: [
        ['action', 'approve'],
        ['projectMode', 'all'],
        ['projectId', 'proj-leftover'],
        ['scopes', 'read'],
      ],
    });
    const stored = await authTransactions.getById(state);
    expect(postResponse.status).toBe(303);
    if (stored?.status !== 'approved') {
      throw new Error('expected approved transaction');
    }
    expect(stored.approvedGrant.projectId).toBeNull();
  });

  it('keeps requested * only when write is approved', async () => {
    const getResponse = await GET(buildAuthorizeRequest({}, 'read write *'));
    const state = extractState(await getResponse.text());
    const form = new FormData();
    form.set('state', state);
    form.set('action', 'approve');
    form.set('projectMode', 'all');
    form.append('scopes', 'read');
    form.append('scopes', 'write');
    appendAllCategories(form);
    const postResponse = await POST(
      new NextRequest(`${SERVER_HOST}/api/authorize`, {
        method: 'POST',
        headers: { cookie: cookieHeader(getResponse) },
        body: form,
      }),
    );
    const stored = await authTransactions.getById(state);
    expect(postResponse.status).toBe(303);
    if (stored?.status !== 'approved') {
      throw new Error('expected approved transaction');
    }
    expect(stored.approvedScopes).toEqual(['read', 'write', '*']);
  });

  it('rejects unsigned JSON state', async () => {
    const state = btoa(
      JSON.stringify({
        responseType: 'code',
        clientId: VALID_CLIENT.id,
        redirectUri: VALID_CLIENT.redirect_uris[0],
        scope: ['read', 'write'],
        state: 'test-state',
      }),
    );
    const response = await postAuthorize({
      state,
      cookie: 'neon_mcp_at_deadbeef=secret',
      fields: [['action', 'approve']],
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_request',
      error_description: AUTH_RESTART_DESCRIPTION,
    });
  });

  it('rejects a cookie from another transaction', async () => {
    const first = await GET(buildAuthorizeRequest());
    const second = await GET(buildAuthorizeRequest());
    const secondState = extractState(await second.text());
    const response = await postAuthorize({
      state: secondState,
      cookie: cookieHeader(first),
      fields: [
        ['action', 'approve'],
        ['projectMode', 'all'],
        ['scopes', 'read'],
      ],
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_request',
      error_description: AUTH_RESTART_DESCRIPTION,
    });
  });

  it('cancels to the registered redirect with the original downstream state', async () => {
    const getResponse = await GET(
      buildAuthorizeRequest({}, 'read write', { state: 'orig-state' }),
    );
    const state = extractState(await getResponse.text());
    const response = await postAuthorize({
      state,
      cookie: cookieHeader(getResponse),
      fields: [['action', 'cancel']],
    });
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.origin + location.pathname).toBe(
      VALID_CLIENT.redirect_uris[0],
    );
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.get('state')).toBe('orig-state');
    expect(await authTransactions.getById(state)).toBeUndefined();
    expect(upstreamAuth).not.toHaveBeenCalled();
  });

  it('lets only one of two concurrent approvals win', async () => {
    const getResponse = await GET(buildAuthorizeRequest());
    const html = await getResponse.text();
    const state = extractState(html);
    const cookie = cookieHeader(getResponse);
    const [first, second] = await Promise.all([
      postAuthorize({
        state,
        cookie,
        fields: [
          ['action', 'approve'],
          ['projectMode', 'all'],
          ['scopes', 'read'],
        ],
      }),
      postAuthorize({
        state,
        cookie,
        fields: [
          ['action', 'approve'],
          ['projectMode', 'one'],
          ['projectId', 'proj-race'],
          ['scopes', 'read'],
        ],
      }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([303, 400]);
    const stored = await authTransactions.getById(state);
    expect(stored?.status).toBe('approved');
  });

  it('keeps two authorizations for one client independent', async () => {
    const firstGet = await GET(
      buildAuthorizeRequest({}, 'read write', {
        state: 'one',
        resource: 'https://mcp.neon.tech/mcp?projectId=proj-one',
      }),
    );
    const secondGet = await GET(
      buildAuthorizeRequest({}, 'read write', {
        state: 'two',
        resource: 'https://mcp.neon.tech/mcp?projectId=proj-two',
      }),
    );
    const firstState = extractState(await firstGet.text());
    const secondState = extractState(await secondGet.text());
    await postAuthorize({
      state: secondState,
      cookie: cookieHeader(secondGet),
      fields: [['action', 'approve']],
    });
    await postAuthorize({
      state: firstState,
      cookie: cookieHeader(firstGet),
      fields: [['action', 'approve']],
    });
    const firstStored = await authTransactions.getById(firstState);
    const secondStored = await authTransactions.getById(secondState);
    if (
      firstStored?.status !== 'approved' ||
      secondStored?.status !== 'approved'
    ) {
      throw new Error('expected both approved');
    }
    expect(firstStored.request.state).toBe('one');
    expect(secondStored.request.state).toBe('two');
    expect(firstStored.approvedGrant.projectId).toBe('proj-one');
    expect(secondStored.approvedGrant.projectId).toBe('proj-two');
  });

  it('re-renders a missing project ID with a field error', async () => {
    const getResponse = await GET(buildAuthorizeRequest());
    const state = extractState(await getResponse.text());
    const response = await postAuthorize({
      state,
      cookie: cookieHeader(getResponse),
      fields: [
        ['action', 'approve'],
        ['projectMode', 'one'],
        ['projectId', ''],
        ['scopes', 'read'],
      ],
    });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('Enter the project ID this connection should use.');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(await authTransactions.getById(state)).toMatchObject({
      status: 'pending',
    });
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('redirects an alternate host to SERVER_HOST before creating a transaction', async () => {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: VALID_CLIENT.id,
      redirect_uri: VALID_CLIENT.redirect_uris[0],
      scope: 'read write',
      state: 'test-state',
    });
    const response = await GET(
      new NextRequest(
        `https://preview.example/api/authorize?${params.toString()}`,
        { method: 'GET' },
      ),
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.origin).toBe(new URL(SERVER_HOST).origin);
    expect(location.pathname).toBe('/api/authorize');
    expect(location.searchParams.get('client_id')).toBe(VALID_CLIENT.id);
    expect(location.searchParams.get('state')).toBe('test-state');
    expect(cookieHeader(response)).not.toContain('neon_mcp_at_');
    expect(model.getClient).not.toHaveBeenCalled();
  });

  it('cancels an empty one-project editor without validating the ID', async () => {
    const getResponse = await GET(buildAuthorizeRequest());
    const state = extractState(await getResponse.text());
    const response = await postAuthorize({
      state,
      cookie: cookieHeader(getResponse),
      fields: [
        ['action', 'cancel'],
        ['projectMode', 'one'],
        ['projectId', ''],
        ['scopes', 'read'],
      ],
    });
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(await authTransactions.getById(state)).toBeUndefined();
  });

  it('cancels after a project ID field error', async () => {
    const getResponse = await GET(buildAuthorizeRequest());
    const state = extractState(await getResponse.text());
    const cookie = cookieHeader(getResponse);
    await postAuthorize({
      state,
      cookie,
      fields: [
        ['action', 'approve'],
        ['projectMode', 'one'],
        ['projectId', ''],
        ['scopes', 'read'],
      ],
    });
    const response = await postAuthorize({
      state,
      cookie,
      fields: [
        ['action', 'cancel'],
        ['projectMode', 'one'],
        ['projectId', ''],
        ['scopes', 'read'],
      ],
    });
    expect(response.status).toBe(303);
    expect(
      new URL(response.headers.get('location') ?? '').searchParams.get('error'),
    ).toBe('access_denied');
    expect(await authTransactions.getById(state)).toBeUndefined();
  });

  it('cancels a confirmation grant', async () => {
    const getResponse = await GET(
      buildAuthorizeRequest({}, 'read write', {
        resource: 'https://mcp.neon.tech/mcp?projectId=proj-123',
      }),
    );
    const state = extractState(await getResponse.text());
    const response = await postAuthorize({
      state,
      cookie: cookieHeader(getResponse),
      fields: [['action', 'cancel']],
    });
    expect(response.status).toBe(303);
    expect(await authTransactions.getById(state)).toBeUndefined();
  });

  it('rejects an expired pending transaction', async () => {
    const getResponse = await GET(buildAuthorizeRequest());
    const state = extractState(await getResponse.text());
    const url = process.env.OAUTH_DATABASE_URL;
    if (!url) {
      throw new Error('OAUTH_DATABASE_URL is required');
    }
    const sql = neon(url);
    await sql`
      UPDATE mcpauth.auth_transactions
      SET expires_at = now() - interval '1 minute'
      WHERE id = ${state}
    `;
    const response = await postAuthorize({
      state,
      cookie: cookieHeader(getResponse),
      fields: [
        ['action', 'approve'],
        ['projectMode', 'all'],
        ['scopes', 'read'],
      ],
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_request',
      error_description: AUTH_RESTART_DESCRIPTION,
    });
    expect(upstreamAuth).not.toHaveBeenCalled();
  });
});
