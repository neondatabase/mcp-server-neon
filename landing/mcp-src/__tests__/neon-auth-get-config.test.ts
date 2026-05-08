import { describe, it, expect, vi } from 'vitest';
import {
  NeonAuthEmailVerificationMethod,
  NeonAuthProviderProjectOwnedBy,
  NeonAuthSupportedAuthProvider,
} from '@neondatabase/api-client';
import { handleGetNeonAuthConfig } from '../tools/handlers/neon-auth-get-config';
import type { ToolHandlerExtraParams } from '../tools/types';

const extra = {} as ToolHandlerExtraParams;

function parseSettingsJson(text: string): Record<string, unknown> {
  const start = text.indexOf('```json');
  const end = text.lastIndexOf('```');
  const raw = text.slice(start + '```json'.length, end).trim();
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('handleGetNeonAuthConfig', () => {
  it('returns the same top-level keys as configure_neon_auth snapshots', async () => {
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
    };

    const result = await handleGetNeonAuthConfig(
      { projectId: 'p1' },
      neonClient as never,
      extra,
    );

    expect(result.isError).toBeFalsy();
    expect(result.content[0].type).toBe('text');
    if (result.content[0].type === 'text') {
      const body = parseSettingsJson(result.content[0].text);
      expect(body.trusted_redirect_uris).toEqual([
        'https://app.example.com/callback',
      ]);
      expect(body.allow_localhost).toBe(true);
      expect(body.sign_in_with_email).toBe(true);
      expect(body.verify_email_on_sign_up).toBe(true);
      expect(body.allow_sign_up_with_email).toBe(true);
      expect(body._errors).toBeUndefined();
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
