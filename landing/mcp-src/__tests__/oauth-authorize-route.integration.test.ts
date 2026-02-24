import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../../app/api/authorize/route';
import { model } from '../oauth/model';
import { isClientAlreadyApproved } from '../../lib/oauth/cookies';

vi.mock('../oauth/model', () => ({
  model: {
    getClient: vi.fn(),
  },
}));

vi.mock('../../lib/oauth/cookies', () => ({
  isClientAlreadyApproved: vi.fn(),
  updateApprovedClientsCookie: vi.fn(),
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
): NextRequest {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: VALID_CLIENT.id,
    redirect_uri: VALID_CLIENT.redirect_uris[0],
    scope,
    state: 'test-state',
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

describe('/api/authorize route integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(model.getClient).mockResolvedValue(
      VALID_CLIENT as unknown as Awaited<ReturnType<typeof model.getClient>>,
    );
    vi.mocked(isClientAlreadyApproved).mockResolvedValue(false);
  });

  it('defaults Full access to checked when no read-only header is set', async () => {
    const response = await GET(buildAuthorizeRequest());
    const html = await response.text();
    const writeCheckbox = extractWriteCheckbox(html);

    expect(response.status).toBe(200);
    expect(writeCheckbox).toContain('checked');
  });

  it('defaults Full access to unchecked when X-Neon-Read-Only is true', async () => {
    const response = await GET(
      buildAuthorizeRequest({
        'X-Neon-Read-Only': 'true',
      }),
    );
    const html = await response.text();
    const writeCheckbox = extractWriteCheckbox(html);

    expect(response.status).toBe(200);
    expect(writeCheckbox).not.toContain('checked');
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

  it('uses X-Neon-Read-Only precedence over x-read-only for checkbox default', async () => {
    const response = await GET(
      buildAuthorizeRequest({
        'X-Neon-Read-Only': 'false',
        'x-read-only': 'true',
      }),
    );
    const html = await response.text();
    const writeCheckbox = extractWriteCheckbox(html);

    expect(response.status).toBe(200);
    expect(writeCheckbox).toContain('checked');
  });
});
