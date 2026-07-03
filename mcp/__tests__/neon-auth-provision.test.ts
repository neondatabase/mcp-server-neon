import { describe, it, expect, vi } from 'vitest';
import { AxiosError } from 'axios';
import {
  NeonAuthProviderProjectOwnedBy,
  NeonAuthSupportedAuthProvider,
} from '@neondatabase/api-client';
import { handleProvisionNeonAuth } from '../tools/handlers/neon-auth';
import type { ToolHandlerExtraParams } from '../tools/types';

const extra = {} as ToolHandlerExtraParams;

function axios409(): AxiosError {
  return new AxiosError(
    'Request failed with status code 409',
    'ERR_BAD_REQUEST',
    {} as never,
    {},
    {
      status: 409,
      statusText: 'Conflict',
      data: { message: 'already exists' },
      headers: {},
      config: {} as never,
    },
  );
}

describe('handleProvisionNeonAuth', () => {
  it('treats HTTP 409 from createNeonAuth as idempotent success (axios throw)', async () => {
    const getNeonAuth = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        auth_provider: NeonAuthSupportedAuthProvider.BetterAuth,
        auth_provider_project_id: 'ap1',
        branch_id: 'br-1',
        db_name: 'neondb',
        created_at: '2025-01-01T00:00:00.000Z',
        owned_by: NeonAuthProviderProjectOwnedBy.Neon,
        jwks_url: 'https://jwks.example/',
        base_url: 'https://auth.example/',
      },
    });
    const neonClient = {
      listProjectBranches: vi.fn().mockResolvedValue({
        data: { branches: [{ id: 'br-1', default: true }] },
      }),
      listProjectBranchDatabases: vi.fn().mockResolvedValue({
        data: { databases: [{ name: 'neondb', owner_name: 'u' }] },
      }),
      createNeonAuth: vi.fn().mockRejectedValue(axios409()),
      getNeonAuth,
    };

    const result = await handleProvisionNeonAuth(
      { projectId: 'p1' },
      neonClient as never,
      extra,
    );

    expect(result.isError).toBeFalsy();
    expect(getNeonAuth).toHaveBeenCalledWith('p1', 'br-1');
    if (result.content[0].type === 'text') {
      expect(result.content[0].text).toContain('Neon Auth already provisioned');
      expect(result.content[0].text).toContain('https://auth.example/');
      expect(result.content[0].text).toContain('https://jwks.example/');
    }
  });
});
