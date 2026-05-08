import { describe, it, expect, vi } from 'vitest';
import {
  NeonAuthEmailVerificationMethod,
  NeonAuthOauthProviderId,
  NeonAuthOauthProviderType,
  NeonAuthProviderProjectOwnedBy,
  NeonAuthSupportedAuthProvider,
} from '@neondatabase/api-client';
import { handleGetNeonAuthConfig } from '../tools/handlers/neon-auth-get-config';
import type { ToolHandlerExtraParams } from '../tools/types';

const extra = {} as ToolHandlerExtraParams;

describe('handleGetNeonAuthConfig', () => {
  it('returns JSON summary on success and omits OAuth client secrets', async () => {
    const neonClient = {
      listProjectBranches: vi.fn().mockResolvedValue({
        data: { branches: [{ id: 'br-1', default: true }] },
      }),
      getNeonAuth: vi.fn().mockResolvedValue({
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
      }),
      listBranchNeonAuthTrustedDomains: vi.fn().mockResolvedValue({
        status: 200,
        data: {
          domains: [
            {
              domain: 'https://app.example.com/callback',
              auth_provider: NeonAuthSupportedAuthProvider.BetterAuth,
            },
          ],
        },
      }),
      getNeonAuthAllowLocalhost: vi.fn().mockResolvedValue({
        status: 200,
        data: { allow_localhost: true },
      }),
      getNeonAuthEmailAndPasswordConfig: vi.fn().mockResolvedValue({
        status: 200,
        data: {
          enabled: true,
          email_verification_method: NeonAuthEmailVerificationMethod.Link,
          require_email_verification: false,
          auto_sign_in_after_verification: true,
          send_verification_email_on_sign_up: true,
          send_verification_email_on_sign_in: false,
          disable_sign_up: false,
        },
      }),
      listBranchNeonAuthOauthProviders: vi.fn().mockResolvedValue({
        status: 200,
        data: {
          providers: [
            {
              id: NeonAuthOauthProviderId.Google,
              type: NeonAuthOauthProviderType.Standard,
              client_id: 'google-client-id',
              client_secret: 'super-secret',
            },
          ],
        },
      }),
    };

    const result = await handleGetNeonAuthConfig(
      { projectId: 'p1' },
      neonClient as never,
      extra,
    );

    expect(result.isError).toBeFalsy();
    expect(result.content[0].type).toBe('text');
    if (result.content[0].type === 'text') {
      expect(result.content[0].text).toContain('Neon Auth configuration');
      expect(result.content[0].text).toContain('"trusted_redirect_uris"');
      expect(result.content[0].text).toContain(
        '"client_secret_configured": true',
      );
      expect(result.content[0].text).not.toContain('super-secret');
    }
  });

  it('returns error when Neon Auth is not provisioned', async () => {
    const neonClient = {
      listProjectBranches: vi.fn().mockResolvedValue({
        data: { branches: [{ id: 'br-1', default: true }] },
      }),
      getNeonAuth: vi.fn().mockResolvedValue({ status: 404 }),
    };

    const result = await handleGetNeonAuthConfig(
      { projectId: 'p1', branchId: 'br-1' },
      neonClient as never,
      extra,
    );

    expect(result.isError).toBe(true);
    if (result.content[0].type === 'text') {
      expect(result.content[0].text).toContain('not provisioned');
    }
  });
});
