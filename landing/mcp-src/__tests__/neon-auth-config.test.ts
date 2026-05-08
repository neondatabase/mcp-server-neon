import { describe, it, expect, vi } from 'vitest';
import { NeonAuthSupportedAuthProvider } from '@neondatabase/api-client';
import { configureNeonAuthInputSchema } from '../tools/toolsSchema';
import { handleConfigureNeonAuth } from '../tools/handlers/neon-auth-config';
import type { ToolHandlerExtraParams } from '../tools/types';

const extra = {} as ToolHandlerExtraParams;

describe('configureNeonAuthInputSchema', () => {
  it('rejects add_redirect_uri without redirect_uri', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'add_redirect_uri',
      projectId: 'proj-1',
    });
    expect(r.success).toBe(false);
  });

  it('rejects update_email_auth_settings when no email flags are set', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_email_auth_settings',
      projectId: 'proj-1',
    });
    expect(r.success).toBe(false);
  });

  it('accepts add_redirect_uri with a valid URL', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'add_redirect_uri',
      projectId: 'proj-1',
      redirect_uri: 'https://app.example.com/auth/callback',
    });
    expect(r.success).toBe(true);
  });

  it('requires allow_localhost for set_allow_localhost', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'set_allow_localhost',
      projectId: 'proj-1',
    });
    expect(r.success).toBe(false);
  });
});

describe('handleConfigureNeonAuth', () => {
  it('calls addBranchNeonAuthTrustedDomain and lists domains', async () => {
    const addBranchNeonAuthTrustedDomain = vi
      .fn()
      .mockResolvedValue({ status: 201 });
    const listBranchNeonAuthTrustedDomains = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        domains: [
          {
            domain: 'https://app.example.com/auth/callback',
            auth_provider: NeonAuthSupportedAuthProvider.BetterAuth,
          },
        ],
      },
    });
    const neonClient = {
      listProjectBranches: vi.fn().mockResolvedValue({
        data: {
          branches: [{ id: 'br-default', default: true }],
        },
      }),
      addBranchNeonAuthTrustedDomain,
      listBranchNeonAuthTrustedDomains,
    };

    const result = await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'add_redirect_uri',
        projectId: 'proj-1',
        redirect_uri: 'https://app.example.com/auth/callback',
      }),
      neonClient as never,
      extra,
    );

    expect(result.isError).toBeFalsy();
    expect(addBranchNeonAuthTrustedDomain).toHaveBeenCalledWith(
      'proj-1',
      'br-default',
      {
        domain: 'https://app.example.com/auth/callback',
        auth_provider: NeonAuthSupportedAuthProvider.BetterAuth,
      },
    );
    expect(result.content[0].type).toBe('text');
    if (result.content[0].type === 'text') {
      expect(result.content[0].text).toContain('Added trusted redirect URI');
      expect(result.content[0].text).toContain(
        'https://app.example.com/auth/callback',
      );
    }
  });

  it('maps email auth flags to the Neon API patch shape', async () => {
    const updateNeonAuthEmailAndPasswordConfig = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        enabled: true,
        email_verification_method: 'link',
        require_email_verification: false,
        auto_sign_in_after_verification: true,
        send_verification_email_on_sign_up: true,
        send_verification_email_on_sign_in: false,
        disable_sign_up: false,
      },
    });
    const neonClient = {
      updateNeonAuthEmailAndPasswordConfig,
    };

    await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'update_email_auth_settings',
        projectId: 'proj-1',
        branchId: 'br-1',
        sign_in_with_email: true,
        verify_email_on_sign_up: true,
        allow_sign_up_with_email: true,
      }),
      neonClient as never,
      extra,
    );

    expect(updateNeonAuthEmailAndPasswordConfig).toHaveBeenCalledWith(
      'proj-1',
      'br-1',
      {
        enabled: true,
        send_verification_email_on_sign_up: true,
        disable_sign_up: false,
      },
    );
  });
});
