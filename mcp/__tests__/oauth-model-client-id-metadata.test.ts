import { beforeEach, describe, expect, it, vi } from 'vitest';

const { clientsGet, resolveDocument } = vi.hoisted(() => ({
  clientsGet: vi.fn(),
  resolveDocument: vi.fn(),
}));

vi.mock('../oauth/kv-store', () => ({
  getClients: () => ({ get: clientsGet }),
  getTokens: vi.fn(),
  getRefreshTokens: vi.fn(),
  getRefreshResults: vi.fn(),
  getRefreshFailures: vi.fn(),
  getAuthorizationCodes: vi.fn(),
  getClientRegisterHeaders: vi.fn(),
}));

vi.mock(
  '../../lib/oauth/client-id-metadata-document',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('../../lib/oauth/client-id-metadata-document')
    >()),
    resolveClientIdMetadataDocument: resolveDocument,
  }),
);

import { model } from '../oauth/model';

describe('model.getClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves a URL client_id from its metadata document, not storage', async () => {
    const clientId = 'https://client.example.com/oauth/metadata.json';
    resolveDocument.mockResolvedValue({ id: clientId });

    expect(await model.getClient(clientId, '')).toEqual({ id: clientId });
    expect(resolveDocument).toHaveBeenCalledWith(clientId);
    expect(clientsGet).not.toHaveBeenCalled();
  });

  it('reads a registered client_id from storage', async () => {
    clientsGet.mockResolvedValue({ id: 'aB3dE5fG' });

    expect(await model.getClient('aB3dE5fG', '')).toEqual({ id: 'aB3dE5fG' });
    expect(resolveDocument).not.toHaveBeenCalled();
  });
});
