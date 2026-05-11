import { describe, it, expect, vi } from 'vitest';
import {
  NeonAuthEmailVerificationMethod,
  NeonAuthSupportedAuthProvider,
} from '@neondatabase/api-client';
import { configureNeonAuthInputSchema } from '../tools/toolsSchema';
import { handleConfigureNeonAuth } from '../tools/handlers/neon-auth-config';
import type { ToolHandlerExtraParams } from '../tools/types';

const extra = {} as ToolHandlerExtraParams;

const EMAIL_PASSWORD_DEFAULTS = {
  enabled: true,
  email_verification_method: NeonAuthEmailVerificationMethod.Link,
  require_email_verification: false,
  auto_sign_in_after_verification: true,
  send_verification_email_on_sign_up: false,
  send_verification_email_on_sign_in: false,
  disable_sign_up: false,
};

describe('configureNeonAuthInputSchema', () => {
  it('rejects add_trusted_origin without trusted_origin', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'add_trusted_origin',
      projectId: 'proj-1',
    });
    expect(r.success).toBe(false);
  });

  it('rejects remove_trusted_origin without trusted_origin', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'remove_trusted_origin',
      projectId: 'proj-1',
    });
    expect(r.success).toBe(false);
  });

  it.each([
    ['plain origin', 'https://app.example.com'],
    ['full URL with path', 'https://app.example.com/auth/callback'],
    ['localhost with port', 'http://localhost:3000'],
    ['single-segment wildcard subdomain', 'https://*.example.com'],
    ['cross-segment wildcard subdomain', 'https://**.example.com'],
    ['wildcard with port and path', 'exp://192.168.*.*:*/**'],
    ['custom scheme only', 'myapp://'],
  ])('accepts add_trusted_origin with %s (%s)', (_label, value) => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'add_trusted_origin',
      projectId: 'proj-1',
      trusted_origin: value,
    });
    expect(r.success).toBe(true);
  });

  it.each([
    ['plain string', 'not-a-url'],
    ['no scheme', 'example.com'],
    ['scheme with no name', '://example.com'],
    ['scheme starting with digit', '1http://example.com'],
    ['leading whitespace', ' https://example.com'],
    ['empty string', ''],
  ])(
    'rejects add_trusted_origin when trusted_origin is %s (%s)',
    (_label, value) => {
      const r = configureNeonAuthInputSchema.safeParse({
        operation: 'add_trusted_origin',
        projectId: 'proj-1',
        trusted_origin: value,
      });
      expect(r.success).toBe(false);
    },
  );

  it('requires allow_localhost for set_allow_localhost', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'set_allow_localhost',
      projectId: 'proj-1',
    });
    expect(r.success).toBe(false);
  });

  it('rejects update_auth_methods when methods is missing', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_auth_methods',
      projectId: 'proj-1',
    });
    expect(r.success).toBe(false);
  });

  it('rejects update_auth_methods when methods is empty', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_auth_methods',
      projectId: 'proj-1',
      methods: {},
    });
    expect(r.success).toBe(false);
  });

  it('rejects update_auth_methods when email_password block has no fields', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_auth_methods',
      projectId: 'proj-1',
      methods: { email_password: {} },
    });
    expect(r.success).toBe(false);
  });

  it('accepts update_auth_methods with a single email_password field', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_auth_methods',
      projectId: 'proj-1',
      methods: { email_password: { enabled: true } },
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown method blocks under methods', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_auth_methods',
      projectId: 'proj-1',
      methods: { magic_link: { enabled: true } },
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown fields inside email_password', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_auth_methods',
      projectId: 'proj-1',
      methods: { email_password: { enabled: true, surprise: 1 } },
    });
    expect(r.success).toBe(false);
  });
});

describe('handleConfigureNeonAuth', () => {
  it('add_trusted_origin calls addBranchNeonAuthTrustedDomain and renders the new snapshot keys', async () => {
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
        data: { branches: [{ id: 'br-default', default: true }] },
      }),
      addBranchNeonAuthTrustedDomain,
      listBranchNeonAuthTrustedDomains,
      getNeonAuthAllowLocalhost: vi.fn().mockResolvedValue({
        status: 200,
        data: { allow_localhost: false },
      }),
      getNeonAuthEmailAndPasswordConfig: vi.fn().mockResolvedValue({
        status: 200,
        data: EMAIL_PASSWORD_DEFAULTS,
      }),
    };

    const result = await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'add_trusted_origin',
        projectId: 'proj-1',
        trusted_origin: 'https://app.example.com/auth/callback',
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
      const text = result.content[0].text;
      expect(text).toContain('Added trusted origin');
      expect(text).toContain('https://app.example.com/auth/callback');
      expect(text).toContain('"trusted_origins"');
      expect(text).toContain('"auth_methods"');
      expect(text).toContain('"email_password"');
      expect(text).toContain('same fields as get_neon_auth_config');
    }
  });

  it('remove_trusted_origin calls deleteBranchNeonAuthTrustedDomain with the URL in batch shape', async () => {
    const deleteBranchNeonAuthTrustedDomain = vi
      .fn()
      .mockResolvedValue({ status: 200 });
    const neonClient = {
      listProjectBranches: vi.fn().mockResolvedValue({
        data: { branches: [{ id: 'br-default', default: true }] },
      }),
      deleteBranchNeonAuthTrustedDomain,
      listBranchNeonAuthTrustedDomains: vi.fn().mockResolvedValue({
        status: 200,
        data: { domains: [] },
      }),
      getNeonAuthAllowLocalhost: vi.fn().mockResolvedValue({
        status: 200,
        data: { allow_localhost: false },
      }),
      getNeonAuthEmailAndPasswordConfig: vi.fn().mockResolvedValue({
        status: 200,
        data: EMAIL_PASSWORD_DEFAULTS,
      }),
    };

    const result = await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'remove_trusted_origin',
        projectId: 'proj-1',
        trusted_origin: 'https://app.example.com/auth/callback',
      }),
      neonClient as never,
      extra,
    );

    expect(result.isError).toBeFalsy();
    expect(deleteBranchNeonAuthTrustedDomain).toHaveBeenCalledWith(
      'proj-1',
      'br-default',
      {
        auth_provider: NeonAuthSupportedAuthProvider.BetterAuth,
        domains: [{ domain: 'https://app.example.com/auth/callback' }],
      },
    );
  });

  it('update_auth_methods maps friendly email_password fields to the Neon API patch shape', async () => {
    const updateNeonAuthEmailAndPasswordConfig = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        ...EMAIL_PASSWORD_DEFAULTS,
        enabled: true,
        send_verification_email_on_sign_up: true,
        send_verification_email_on_sign_in: false,
        require_email_verification: true,
        auto_sign_in_after_verification: false,
        email_verification_method: NeonAuthEmailVerificationMethod.Otp,
        disable_sign_up: false,
      },
    });
    const neonClient = {
      updateNeonAuthEmailAndPasswordConfig,
      listBranchNeonAuthTrustedDomains: vi.fn().mockResolvedValue({
        status: 200,
        data: { domains: [] },
      }),
      getNeonAuthAllowLocalhost: vi.fn().mockResolvedValue({
        status: 200,
        data: { allow_localhost: true },
      }),
      getNeonAuthEmailAndPasswordConfig: vi.fn().mockResolvedValue({
        status: 200,
        data: {
          ...EMAIL_PASSWORD_DEFAULTS,
          send_verification_email_on_sign_up: true,
          require_email_verification: true,
          auto_sign_in_after_verification: false,
          email_verification_method: NeonAuthEmailVerificationMethod.Otp,
        },
      }),
    };

    await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'update_auth_methods',
        projectId: 'proj-1',
        branchId: 'br-1',
        methods: {
          email_password: {
            enabled: true,
            allow_sign_up: true,
            verify_email_on_sign_up: true,
            verify_email_on_sign_in: false,
            email_verification_method: 'otp',
            require_email_verification: true,
            auto_sign_in_after_verification: false,
          },
        },
      }),
      neonClient as never,
      extra,
    );

    expect(updateNeonAuthEmailAndPasswordConfig).toHaveBeenCalledWith(
      'proj-1',
      'br-1',
      {
        enabled: true,
        disable_sign_up: false,
        send_verification_email_on_sign_up: true,
        send_verification_email_on_sign_in: false,
        email_verification_method: NeonAuthEmailVerificationMethod.Otp,
        require_email_verification: true,
        auto_sign_in_after_verification: false,
      },
    );
  });

  it('update_auth_methods sends only the fields the caller provided (partial patch)', async () => {
    const updateNeonAuthEmailAndPasswordConfig = vi.fn().mockResolvedValue({
      status: 200,
      data: EMAIL_PASSWORD_DEFAULTS,
    });
    const neonClient = {
      updateNeonAuthEmailAndPasswordConfig,
      listBranchNeonAuthTrustedDomains: vi.fn().mockResolvedValue({
        status: 200,
        data: { domains: [] },
      }),
      getNeonAuthAllowLocalhost: vi.fn().mockResolvedValue({
        status: 200,
        data: { allow_localhost: false },
      }),
      getNeonAuthEmailAndPasswordConfig: vi.fn().mockResolvedValue({
        status: 200,
        data: EMAIL_PASSWORD_DEFAULTS,
      }),
    };

    await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'update_auth_methods',
        projectId: 'proj-1',
        branchId: 'br-1',
        methods: { email_password: { allow_sign_up: false } },
      }),
      neonClient as never,
      extra,
    );

    expect(updateNeonAuthEmailAndPasswordConfig).toHaveBeenCalledWith(
      'proj-1',
      'br-1',
      { disable_sign_up: true },
    );
  });
});
