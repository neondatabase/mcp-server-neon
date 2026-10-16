import { describe, expect, it, vi } from 'vitest';
import { handleFetch } from '../tools/handlers/fetch';
import type { ToolHandlerExtraParams } from '../tools/types';

const extra = {
  account: { id: 'user-1', name: 'Ada', isOrg: false },
  apiKey: 'napi_test',
} as ToolHandlerExtraParams;

function neonClient() {
  return {
    getOrganization: vi.fn((orgId: string) =>
      orgId === 'org-acme-12345678'
        ? Promise.resolve({
            data: {
              id: orgId,
              name: 'Acme',
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:00Z',
            },
          })
        : Promise.reject(new Error(`organization ${orgId} not found`)),
    ),
    getOrganizationMembers: vi.fn().mockResolvedValue({
      data: { members: [] },
    }),
    listProjects: vi.fn().mockResolvedValue({ data: { projects: [] } }),
  };
}

describe('fetch organization', () => {
  it.each(['org:org-acme-12345678', 'org-acme-12345678'])(
    'fetches the organization for id %s',
    async (id) => {
      const client = neonClient();

      const result = await handleFetch({ id }, client as never, extra);

      expect(client.getOrganization).toHaveBeenCalledWith('org-acme-12345678');
      expect(result.isError).toBeFalsy();
    },
  );
});
