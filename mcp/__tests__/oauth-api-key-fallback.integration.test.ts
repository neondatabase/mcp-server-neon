import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GrantContext } from '../utils/grant-context';
import type { ApiKeyRecord } from '../oauth/kv-store';

const { apiKeyCache, apiKeyCacheGet, getAuthDetails } = vi.hoisted(() => {
  const apiKeyCache = new Map<string, unknown>();
  return {
    apiKeyCache,
    apiKeyCacheGet: vi.fn(async (key: string) => apiKeyCache.get(key)),
    getAuthDetails: vi.fn(),
  };
});

vi.mock('../oauth/model', () => ({
  model: { getAccessToken: vi.fn() },
}));

vi.mock('../oauth/kv-store', async () => {
  const actual =
    await vi.importActual<typeof import('../oauth/kv-store')>(
      '../oauth/kv-store',
    );
  return {
    ...actual,
    getApiKeys: () => ({
      get: apiKeyCacheGet,
      set: async (key: string, value: unknown) => {
        apiKeyCache.set(key, value);
      },
    }),
  };
});

vi.mock('../server/api', () => ({
  createNeonClient: () => ({
    getAuthDetails,
    getCurrentUserInfo: async () => ({
      data: { id: 'user-1', name: 'User', last_name: '', email: 'u@x.dev' },
    }),
    getOrganization: async () => ({ data: { name: 'Org' } }),
  }),
}));

vi.mock('../analytics/analytics', () => ({
  track: vi.fn(),
  identify: vi.fn(),
  flushAnalytics: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    silent: false,
  },
}));

const { model } = await import('../oauth/model');
const { POST, GET, HEAD } = await import('../../app/api/[transport]/route');

const OAUTH_BEARER = 'oauth-bearer-from-the-mcp-oauth-flow';
const API_KEY = 'napi_test_api_key';

function storedOAuthToken(scope: string, grant: GrantContext) {
  return {
    accessToken: OAUTH_BEARER,
    scope,
    client: { id: 'client-1', client_name: 'Cursor', grants: ['*'] },
    user: { id: 'user-1', name: 'User', email: 'u@x.dev' },
    grant,
  };
}

function storeLookupFails() {
  vi.mocked(model.getAccessToken).mockRejectedValue(
    Object.assign(new Error('sorry, too many clients already'), {
      code: '53300',
    }),
  );
}

function neonSays(authMethod: ApiKeyRecord['authMethod']) {
  getAuthDetails.mockResolvedValue({
    data: { auth_method: authMethod, account_id: 'org-1' },
  });
}

function request(
  method: string,
  path: string,
  bearer: string,
  body?: unknown,
): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function listTools(bearer: string, query = '') {
  const res = await POST(
    request('POST', `/mcp${query}`, bearer, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    }),
  );
  const raw = await res.text();
  const dataLine = raw
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .pop();
  const body: unknown = JSON.parse(dataLine ? dataLine.slice(6) : raw);
  return { res, body };
}

function toolNames(body: unknown): string[] {
  const parsed = body as { result?: { tools?: Array<{ name: string }> } };
  return (parsed.result?.tools ?? []).map((tool) => tool.name);
}

function expectTokenStoreUnavailable(res: Response) {
  expect(res.status).toBe(503);
  expect(res.headers.get('Retry-After')).toBe('5');
  expect(res.headers.get('WWW-Authenticate')).toBeNull();
}

describe('OAuth bearer on the API-key path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiKeyCache.clear();
    apiKeyCacheGet.mockImplementation(async (key: string) =>
      apiKeyCache.get(key),
    );
  });

  it('keeps the stored read-only grant when the token store answers', async () => {
    vi.mocked(model.getAccessToken).mockResolvedValue(
      storedOAuthToken('read', { projectId: null, scopes: null }) as never,
    );

    const { res, body } = await listTools(OAUTH_BEARER, '?readonly=false');

    expect(res.status).toBe(200);
    expect(toolNames(body)).toContain('run_sql');
    expect(toolNames(body)).not.toContain('create_project');
    expect(getAuthDetails).not.toHaveBeenCalled();
  });

  it('answers 503 instead of a URL grant when the token store lookup fails', async () => {
    storeLookupFails();
    neonSays('oauth');

    const { res, body } = await listTools(OAUTH_BEARER);

    expectTokenStoreUnavailable(res);
    expect(body).toEqual({
      error: 'Token store unavailable',
      code: 'token_store_unavailable',
    });
  });

  it('answers 503 for a cached OAuth record without asking Neon again', async () => {
    storeLookupFails();
    apiKeyCache.set(OAUTH_BEARER, {
      apiKey: OAUTH_BEARER,
      authMethod: 'oauth',
      account: { id: 'user-1', name: 'User', isOrg: false },
    });

    const { res } = await listTools(OAUTH_BEARER);

    expectTokenStoreUnavailable(res);
    expect(getAuthDetails).not.toHaveBeenCalled();
  });

  it('answers 401 with the OAuth challenge when the store has no record', async () => {
    vi.mocked(model.getAccessToken).mockResolvedValue(undefined);
    neonSays('oauth');

    const { res } = await listTools(OAUTH_BEARER);

    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('Bearer');
    expect(res.headers.get('WWW-Authenticate')).toContain('resource_metadata=');
  });

  it.each(['/sse', '/api/sse'])(
    'answers 503 on GET %s before opening a stream',
    async (path) => {
      storeLookupFails();
      neonSays('oauth');

      const res = await GET(request('GET', path, OAUTH_BEARER));

      expectTokenStoreUnavailable(res);
      expect(res.headers.get('Content-Type')).toBe('application/json');
    },
  );

  it('answers 503 on an SSE message POST', async () => {
    storeLookupFails();
    neonSays('oauth');

    const res = await POST(
      request('POST', '/api/message?sessionId=session-1', OAUTH_BEARER, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      }),
    );

    expectTokenStoreUnavailable(res);
  });

  it.each(['/mcp', '/api/mcp', '/sse'])(
    'answers HEAD %s with an empty 503 when the store is down and 401 when the record is missing',
    async (path) => {
      storeLookupFails();
      neonSays('oauth');
      const unavailable = await HEAD(request('HEAD', path, OAUTH_BEARER));
      expectTokenStoreUnavailable(unavailable);
      expect(await unavailable.text()).toBe('');

      vi.mocked(model.getAccessToken).mockResolvedValue(undefined);
      const missing = await HEAD(request('HEAD', path, OAUTH_BEARER));
      expect(missing.status).toBe(401);
      expect(missing.headers.get('WWW-Authenticate')).toContain(
        'resource_metadata=',
      );
      expect(await missing.text()).toBe('');
    },
  );

  it.each(['api_key_user', 'api_key_org'] as const)(
    'keeps %s working with its URL grant while the token store is down',
    async (authMethod) => {
      storeLookupFails();
      neonSays(authMethod);

      const { res, body } = await listTools(
        API_KEY,
        '?readonly=true&category=querying',
      );

      expect(res.status).toBe(200);
      expect(toolNames(body)).toContain('run_sql');
      expect(toolNames(body)).not.toContain('run_sql_transaction');
      expect(toolNames(body)).not.toContain('list_projects');
    },
  );

  it('keeps an API key working when the API-key cache is down too', async () => {
    storeLookupFails();
    apiKeyCacheGet.mockRejectedValue(new Error('sorry, too many clients'));
    neonSays('api_key_user');

    const { res, body } = await listTools(API_KEY);

    expect(res.status).toBe(200);
    expect(toolNames(body)).toContain('create_project');
  });

  it('keeps an API key without a token-store record on its URL grant', async () => {
    vi.mocked(model.getAccessToken).mockResolvedValue(undefined);
    neonSays('api_key_org');

    const { res, body } = await listTools(API_KEY, '?projectId=proj-1');

    expect(res.status).toBe(200);
    expect(toolNames(body)).not.toContain('list_projects');
    expect(toolNames(body)).toContain('run_sql');
  });
});
