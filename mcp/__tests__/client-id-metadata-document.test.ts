import { describe, expect, it, vi } from 'vitest';
import {
  ClientMetadataUnavailableError,
  createClientMetadataResolver,
  fetchOverHttps,
  isBlockedAddress,
  isClientIdMetadataUrl,
  MetadataDocumentRefusedError,
  type FetchMetadataDocument,
  type MetadataDocumentResponse,
} from '../../lib/oauth/client-id-metadata-document';
import { handleOAuthError } from '../../lib/errors';

const CLIENT_ID = 'https://client.example.com/oauth/metadata.json';

const validDocument = {
  client_id: CLIENT_ID,
  client_name: 'Example MCP Client',
  client_uri: 'https://somewhere-else.example',
  redirect_uris: ['http://127.0.0.1:3000/callback'],
  token_endpoint_auth_method: 'none',
};

const respond = (
  overrides: Partial<MetadataDocumentResponse> & { json?: unknown } = {},
): MetadataDocumentResponse => ({
  status: 200,
  contentType: 'application/json',
  cacheControl: undefined,
  body: JSON.stringify(overrides.json ?? validDocument),
  ...overrides,
});

const resolveWith = (response: MetadataDocumentResponse) =>
  createClientMetadataResolver(async () => response)(CLIENT_ID);

const resolveDocument = (change: Record<string, unknown>) =>
  resolveWith(respond({ json: { ...validDocument, ...change } }));

describe('isClientIdMetadataUrl', () => {
  it('tells a metadata URL from a registered client id', () => {
    expect(isClientIdMetadataUrl(CLIENT_ID)).toBe(true);
    expect(isClientIdMetadataUrl('aB3dE5fG')).toBe(false);
  });
});

describe('createClientMetadataResolver', () => {
  it('resolves a valid document to a public client', async () => {
    const client = await resolveWith(respond());

    expect(client).toMatchObject({
      id: CLIENT_ID,
      client_name: 'Example MCP Client',
      redirect_uris: ['http://127.0.0.1:3000/callback'],
      grants: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      tokenEndpointAuthMethod: 'none',
    });
    expect(client?.secret).toBeUndefined();
  });

  it('shows the verified client_id origin as the website, not the self-asserted client_uri', async () => {
    const client = await resolveWith(respond());

    expect(client?.client_uri).toBe('https://client.example.com');
  });

  it.each([
    ['http://client.example.com/metadata.json'],
    ['https://client.example.com/'],
    ['https://client.example.com/a#frag'],
    ['https://user:pw@client.example.com/a'],
    ['https://client.example.com/a/../b'],
    ['https://CLIENT.example.com/a'],
  ])('refuses %s without fetching it', async (clientId) => {
    const fetchDocument = vi.fn<FetchMetadataDocument>();

    expect(
      await createClientMetadataResolver(fetchDocument)(clientId),
    ).toBeUndefined();
    expect(fetchDocument).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a client_id that is not its URL',
      { client_id: 'https://evil.example/x' },
    ],
    ['a client secret', { client_secret: 's' }],
    [
      'a shared-secret auth method',
      { token_endpoint_auth_method: 'client_secret_post' },
    ],
    [
      'a shared-secret method among the supported ones',
      {
        token_endpoint_auth_methods_supported: ['none', 'client_secret_basic'],
      },
    ],
    ['only private_key_jwt', { token_endpoint_auth_method: 'private_key_jwt' }],
    ['no client_name', { client_name: undefined }],
    ['no redirect_uris', { redirect_uris: undefined }],
    [
      'a javascript: redirect_uri',
      { redirect_uris: ['https://client.example/cb', 'javascript:alert(1)'] },
    ],
  ])('refuses a document with %s', async (_, change) => {
    expect(await resolveDocument(change)).toBeUndefined();
  });

  it('accepts a native app scheme next to loopback, as /api/register does', async () => {
    const redirectUris = [
      'cursor://anysphere.cursor-mcp/oauth/callback',
      'http://127.0.0.1:3000/callback',
    ];

    const client = await resolveDocument({ redirect_uris: redirectUris });

    expect(client?.redirect_uris).toEqual(redirectUris);
  });

  it('serves a client offering both none and private_key_jwt as public', async () => {
    const client = await resolveDocument({
      token_endpoint_auth_method: 'private_key_jwt',
      token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
    });

    expect(client?.tokenEndpointAuthMethod).toBe('none');
  });

  it.each([
    ['a 404', respond({ status: 404 })],
    ['a non-JSON content type', respond({ contentType: 'text/html' })],
    ['a body that is not JSON', respond({ body: '<html>' })],
  ])('refuses %s as an unknown client', async (_, response) => {
    expect(await resolveWith(response)).toBeUndefined();
  });

  it.each([503, 429])(
    'throws ClientMetadataUnavailableError on a %i',
    async (status) => {
      await expect(resolveWith(respond({ status }))).rejects.toBeInstanceOf(
        ClientMetadataUnavailableError,
      );
    },
  );

  it('throws ClientMetadataUnavailableError when the host cannot be reached', async () => {
    const resolve = createClientMetadataResolver(async () => {
      throw new Error('timed out');
    });

    await expect(resolve(CLIENT_ID)).rejects.toBeInstanceOf(
      ClientMetadataUnavailableError,
    );
  });

  it('refuses, rather than retries, a fetch that was refused', async () => {
    const resolve = createClientMetadataResolver(async () => {
      throw new MetadataDocumentRefusedError(
        'resolves to a non-public address',
      );
    });

    expect(await resolve(CLIENT_ID)).toBeUndefined();
  });

  it('caches a valid document for its max-age', async () => {
    let now = 1_000_000;
    const fetchDocument = vi.fn(async () =>
      respond({ cacheControl: 'public, max-age=60' }),
    );
    const resolve = createClientMetadataResolver(fetchDocument, () => now);

    await resolve(CLIENT_ID);
    now += 59_000;
    await resolve(CLIENT_ID);
    expect(fetchDocument).toHaveBeenCalledTimes(1);

    now += 2_000;
    await resolve(CLIENT_ID);
    expect(fetchDocument).toHaveBeenCalledTimes(2);
  });

  it('does not cache a document marked no-store', async () => {
    const fetchDocument = vi.fn(async () =>
      respond({ cacheControl: 'no-store' }),
    );
    const resolve = createClientMetadataResolver(fetchDocument);

    await resolve(CLIENT_ID);
    await resolve(CLIENT_ID);

    expect(fetchDocument).toHaveBeenCalledTimes(2);
  });

  it('does not cache a refusal', async () => {
    const fetchDocument = vi
      .fn<FetchMetadataDocument>()
      .mockResolvedValueOnce(respond({ status: 404 }))
      .mockResolvedValueOnce(respond());
    const resolve = createClientMetadataResolver(fetchDocument);

    expect(await resolve(CLIENT_ID)).toBeUndefined();
    expect(await resolve(CLIENT_ID)).toBeDefined();
  });
});

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '192.0.2.1',
    '198.51.100.1',
    '203.0.113.1',
    '2001:db8::1',
    // 6to4 address embedding 10.0.0.1
    '2002:a00:1::1',
    // Teredo
    '2001:0:4136:e378::1',
    '100::1',
  ])('blocks %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(['93.184.215.14', '2606:4700::1111'])('allows %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

describe('fetchOverHttps', () => {
  it('refuses a private IP literal before connecting', async () => {
    await expect(
      fetchOverHttps(new URL('https://169.254.169.254/latest/meta-data')),
    ).rejects.toBeInstanceOf(MetadataDocumentRefusedError);
  });

  it('refuses a hostname that resolves to loopback', async () => {
    await expect(
      fetchOverHttps(new URL('https://localhost/metadata.json')),
    ).rejects.toBeInstanceOf(MetadataDocumentRefusedError);
  });
});

describe('handleOAuthError', () => {
  it('answers an unreadable metadata document with 503, not invalid_client', async () => {
    const response = handleOAuthError(
      new ClientMetadataUnavailableError('timed out'),
      'test',
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('30');
    expect(await response.json()).toMatchObject({
      error: 'temporarily_unavailable',
    });
  });
});
