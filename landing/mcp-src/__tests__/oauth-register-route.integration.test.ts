import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, OPTIONS } from '../../app/api/register/route';
import { model } from '../oauth/model';

vi.mock('../oauth/model', () => ({
  model: {
    saveClient: vi.fn(),
    saveClientRegisterHeaders: vi.fn(),
  },
}));

const VALID_PAYLOAD = {
  client_name: 'Codex',
  redirect_uris: ['http://127.0.0.1:55555/callback'],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
};

function buildRequest(
  body: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest('http://localhost/api/register', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe('/api/register route integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(model.saveClient).mockImplementation(async (client) => client);
    vi.mocked(model.saveClientRegisterHeaders).mockImplementation(
      async (_clientId, requestHeaders) => ({
        headers: requestHeaders,
        createdAt: Date.now(),
      }),
    );
  });

  it('returns a valid response and stores register headers for a valid request', async () => {
    const response = await POST(
      buildRequest(VALID_PAYLOAD, {
        'X-Neon-Read-Only': 'true',
        'x-read-only': 'false',
      }),
    );
    const body = (await response.json()) as {
      client_id: string;
      client_secret: string;
      token_endpoint_auth_method: string;
    };

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
    expect(body.client_id).toBeTypeOf('string');
    expect(body.client_secret).toBeTypeOf('string');
    expect(body.token_endpoint_auth_method).toBe('none');
    expect(vi.mocked(model.saveClient)).toHaveBeenCalledOnce();
    expect(vi.mocked(model.saveClientRegisterHeaders)).toHaveBeenCalledWith(
      body.client_id,
      expect.objectContaining({
        'x-neon-read-only': 'true',
        'x-read-only': 'false',
      }),
    );
  });

  it('returns 400 when client_name is missing', async () => {
    const { client_name: _clientName, ...payloadWithoutClientName } =
      VALID_PAYLOAD;

    const response = await POST(buildRequest(payloadWithoutClientName));
    const body = (await response.json()) as {
      error: string;
      error_description: string;
    };

    expect(response.status).toBe(400);
    expect(body.error).toBe('invalid_request');
    expect(body.error_description).toContain('client_name');
    expect(vi.mocked(model.saveClient)).not.toHaveBeenCalled();
  });

  it('returns 400 when redirect_uris is missing', async () => {
    const { redirect_uris: _redirectUris, ...payloadWithoutRedirectUris } =
      VALID_PAYLOAD;

    const response = await POST(buildRequest(payloadWithoutRedirectUris));
    const body = (await response.json()) as {
      error: string;
      error_description: string;
    };

    expect(response.status).toBe(400);
    expect(body.error).toBe('invalid_request');
    expect(body.error_description).toContain('redirect_uris');
    expect(vi.mocked(model.saveClient)).not.toHaveBeenCalled();
  });

  it('returns 400 when grant_types contains unsupported values', async () => {
    const response = await POST(
      buildRequest({
        ...VALID_PAYLOAD,
        grant_types: ['client_credentials'],
      }),
    );
    const body = (await response.json()) as {
      error: string;
      error_description: string;
    };

    expect(response.status).toBe(400);
    expect(body.error).toBe('invalid_request');
    expect(body.error_description).toContain('grant_types');
    expect(vi.mocked(model.saveClient)).not.toHaveBeenCalled();
  });

  it('returns 400 when response_types contains unsupported values', async () => {
    const response = await POST(
      buildRequest({
        ...VALID_PAYLOAD,
        response_types: ['token'],
      }),
    );
    const body = (await response.json()) as {
      error: string;
      error_description: string;
    };

    expect(response.status).toBe(400);
    expect(body.error).toBe('invalid_request');
    expect(body.error_description).toContain('response_types');
    expect(vi.mocked(model.saveClient)).not.toHaveBeenCalled();
  });

  it('returns 204 and CORS headers for OPTIONS', async () => {
    const response = await OPTIONS();

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toContain(
      'POST',
    );
    expect(response.headers.get('access-control-allow-headers')).toContain(
      'X-Neon-Read-Only',
    );
    expect(response.headers.get('access-control-allow-headers')).toContain(
      'x-read-only',
    );
  });
});
