import { describe, it, expect, vi } from 'vitest';
import {
  NeonAuthEmailVerificationMethod,
  NeonAuthSupportedAuthProvider,
} from '@neondatabase/api-client';
import { configureNeonAuthInputSchema } from '../tools/toolsSchema';
import { handleConfigureNeonAuth } from '../tools/handlers/neon-auth-config';
import { REDACTED_SECRET } from '../tools/handlers/neon-auth-settings-snapshot';
import type { ToolHandlerExtraParams } from '../tools/types';
import {
  EMAIL_PASSWORD_DEFAULTS,
  defaultSnapshotMocks,
} from './helpers/neon-auth-mocks';

const extra = {} as ToolHandlerExtraParams;

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
    ['https origin', 'https://app.example.com'],
    ['https URL with path', 'https://app.example.com/auth/callback'],
    ['http localhost with port', 'http://localhost:3000'],
    ['http localhost without port', 'http://localhost'],
    ['http 127.0.0.1 with port', 'http://127.0.0.1:8080'],
    ['http IPv6 loopback', 'http://[::1]:3000'],
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
    // Format-level rejects
    ['plain string', 'not-a-url'],
    ['no scheme', 'example.com'],
    ['scheme with no name', '://example.com'],
    ['scheme starting with digit', '1http://example.com'],
    ['leading whitespace', ' https://example.com'],
    ['empty string', ''],
    // Security-level rejects: bare/TLD-only wildcards (match-everything CSRF holes)
    ['host-only wildcard', 'https://*'],
    ['host-only double wildcard', 'https://**'],
    ['TLD-only wildcard .com', 'https://*.com'],
    ['TLD-only wildcard .io', 'https://*.io'],
    // Security-level rejects: empty host
    ['https with no host', 'https://'],
    ['https with port only', 'https://:8080'],
    // Security-level rejects: non-localhost http
    ['http to remote host', 'http://example.com'],
    ['http subdomain wildcard', 'http://*.example.com'],
    // Security-level rejects: dangerous schemes
    ['file scheme', 'file:///etc/passwd'],
    ['javascript scheme', 'javascript://example.com'],
    ['data scheme via ://', 'data://text/plain,foo'],
    ['vbscript scheme', 'vbscript://example.com'],
    ['about scheme', 'about://blank'],
    // Security-level rejects: control characters
    ['embedded NUL', 'https://example.com\u0000evil.com'],
    ['embedded tab', 'https://example.com\tevil.com'],
    ['embedded DEL', 'https://example.com\u007Fevil.com'],
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

  // OAuth provider operations ------------------------------------------------

  it('rejects add_oauth_provider without oauth_provider', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'add_oauth_provider',
      projectId: 'proj-1',
    });
    expect(r.success).toBe(false);
  });

  it('rejects add_oauth_provider with unknown provider id', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'add_oauth_provider',
      projectId: 'proj-1',
      oauth_provider: 'twitter',
    });
    expect(r.success).toBe(false);
  });

  it('accepts add_oauth_provider in shared mode (no client credentials)', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'add_oauth_provider',
      projectId: 'proj-1',
      oauth_provider: 'google',
    });
    expect(r.success).toBe(true);
  });

  it('accepts add_oauth_provider in standard mode (client_id + client_secret)', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'add_oauth_provider',
      projectId: 'proj-1',
      oauth_provider: 'github',
      oauth_provider_config: {
        client_id: 'app-id',
        client_secret: 'app-secret',
      },
    });
    expect(r.success).toBe(true);
  });

  it('rejects add_oauth_provider with only client_id (BYO mode requires both)', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'add_oauth_provider',
      projectId: 'proj-1',
      oauth_provider: 'github',
      oauth_provider_config: { client_id: 'app-id' },
    });
    expect(r.success).toBe(false);
  });

  it('rejects add_oauth_provider with only client_secret (BYO mode requires both)', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'add_oauth_provider',
      projectId: 'proj-1',
      oauth_provider: 'github',
      oauth_provider_config: { client_secret: 'app-secret' },
    });
    expect(r.success).toBe(false);
  });

  it('rejects update_oauth_provider when oauth_provider_config is missing', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_oauth_provider',
      projectId: 'proj-1',
      oauth_provider: 'google',
    });
    expect(r.success).toBe(false);
  });

  it('rejects update_oauth_provider when oauth_provider_config is empty', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_oauth_provider',
      projectId: 'proj-1',
      oauth_provider: 'google',
      oauth_provider_config: {},
    });
    expect(r.success).toBe(false);
  });

  it('accepts update_oauth_provider with a single field (partial patch)', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_oauth_provider',
      projectId: 'proj-1',
      oauth_provider: 'google',
      oauth_provider_config: { client_id: 'new-id' },
    });
    expect(r.success).toBe(true);
  });

  it('accepts remove_oauth_provider with oauth_provider only', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'remove_oauth_provider',
      projectId: 'proj-1',
      oauth_provider: 'vercel',
    });
    expect(r.success).toBe(true);
  });

  // Email provider + send_test_email -----------------------------------------

  it('rejects update_email_provider without email_provider', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_email_provider',
      projectId: 'proj-1',
    });
    expect(r.success).toBe(false);
  });

  it('rejects update_email_provider when type=standard is missing required fields', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_email_provider',
      projectId: 'proj-1',
      email_provider: {
        type: 'standard',
        host: 'smtp.example.com',
        // missing port, username, password, sender_email, sender_name
      },
    });
    expect(r.success).toBe(false);
  });

  it('rejects update_email_provider when port is out of range', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_email_provider',
      projectId: 'proj-1',
      email_provider: {
        type: 'standard',
        host: 'smtp.example.com',
        port: 70000,
        username: 'apikey',
        password: 'secret',
        sender_email: 'noreply@example.com',
        sender_name: 'Acme',
      },
    });
    expect(r.success).toBe(false);
  });

  it('accepts update_email_provider with type=standard and all required fields', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_email_provider',
      projectId: 'proj-1',
      email_provider: {
        type: 'standard',
        host: 'smtp.example.com',
        port: 587,
        username: 'apikey',
        password: 'secret',
        sender_email: 'noreply@example.com',
        sender_name: 'Acme',
      },
    });
    expect(r.success).toBe(true);
  });

  it('accepts update_email_provider with type=shared and no overrides', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_email_provider',
      projectId: 'proj-1',
      email_provider: { type: 'shared' },
    });
    expect(r.success).toBe(true);
  });

  it('rejects update_email_provider with unknown discriminator', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_email_provider',
      projectId: 'proj-1',
      email_provider: { type: 'sendgrid' },
    });
    expect(r.success).toBe(false);
  });

  it('rejects send_test_email without test_email', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'send_test_email',
      projectId: 'proj-1',
    });
    expect(r.success).toBe(false);
  });

  it('rejects send_test_email when recipient_email is invalid', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'send_test_email',
      projectId: 'proj-1',
      test_email: {
        recipient_email: 'not-an-email',
        host: 'smtp.example.com',
        port: 587,
        username: 'apikey',
        password: 'secret',
        sender_email: 'noreply@example.com',
        sender_name: 'Acme',
      },
    });
    expect(r.success).toBe(false);
  });

  it('accepts send_test_email with full SMTP credentials + recipient', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'send_test_email',
      projectId: 'proj-1',
      test_email: {
        recipient_email: 'tester@example.com',
        host: 'smtp.example.com',
        port: 587,
        username: 'apikey',
        password: 'secret',
        sender_email: 'noreply@example.com',
        sender_name: 'Acme',
      },
    });
    expect(r.success).toBe(true);
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
      ...defaultSnapshotMocks(),
      listProjectBranches: vi.fn().mockResolvedValue({
        data: { branches: [{ id: 'br-default', default: true }] },
      }),
      addBranchNeonAuthTrustedDomain,
      listBranchNeonAuthTrustedDomains,
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
      expect(text).toContain('Requested add of trusted origin');
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
      ...defaultSnapshotMocks(),
      listProjectBranches: vi.fn().mockResolvedValue({
        data: { branches: [{ id: 'br-default', default: true }] },
      }),
      deleteBranchNeonAuthTrustedDomain,
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
    if (result.content[0].type === 'text') {
      // The Neon batch-delete API returns 200 even if the entry was absent,
      // so the header must not claim definitive removal.
      expect(result.content[0].text).toContain(
        'Requested remove of trusted origin',
      );
      expect(result.content[0].text).not.toContain('Removed trusted origin:');
    }
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
      ...defaultSnapshotMocks(),
      updateNeonAuthEmailAndPasswordConfig,
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
      ...defaultSnapshotMocks(),
      updateNeonAuthEmailAndPasswordConfig,
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

  it('update_auth_methods throws if no method block can be applied (defense-in-depth against schema/handler skew)', async () => {
    // Bypass the input schema to simulate a future state where a new method
    // block (e.g. magic_link) is added to the schema but its corresponding
    // handler arm has not been wired up yet. The handler must fail loudly
    // instead of silently returning a "success" snapshot.
    const neonClient = {
      listProjectBranches: vi.fn().mockResolvedValue({
        data: { branches: [{ id: 'br-default', default: true }] },
      }),
      // Satisfy the `ensureNeonAuthProvisioned` prereq probe so the handler
      // reaches the schema/handler-skew check we are actually testing here.
      getNeonAuth: vi.fn().mockResolvedValue({ status: 200, data: {} }),
    };

    await expect(
      handleConfigureNeonAuth(
        {
          operation: 'update_auth_methods',
          projectId: 'proj-1',
          methods: { magic_link: { enabled: true } },
        } as never,
        neonClient as never,
        extra,
      ),
    ).rejects.toThrow(/no handler applied for methods=magic_link/);
  });

  // OAuth provider handler tests --------------------------------------------

  it('add_oauth_provider in shared mode passes only id and renders an OAuth-only summary', async () => {
    const addBranchNeonAuthOauthProvider = vi
      .fn()
      .mockResolvedValue({ status: 201 });
    const neonClient = {
      ...defaultSnapshotMocks(),
      listProjectBranches: vi.fn().mockResolvedValue({
        data: { branches: [{ id: 'br-default', default: true }] },
      }),
      addBranchNeonAuthOauthProvider,
      listBranchNeonAuthOauthProviders: vi.fn().mockResolvedValue({
        status: 200,
        data: {
          providers: [{ id: 'google', type: 'shared' }],
        },
      }),
    };

    const result = await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'add_oauth_provider',
        projectId: 'proj-1',
        oauth_provider: 'google',
      }),
      neonClient as never,
      extra,
    );

    expect(result.isError).toBeFalsy();
    expect(addBranchNeonAuthOauthProvider).toHaveBeenCalledWith(
      'proj-1',
      'br-default',
      { id: 'google' },
    );
    if (result.content[0].type === 'text') {
      const text = result.content[0].text;
      expect(text).toContain('Requested add of OAuth provider google');
      // Header is intentionally mode-agnostic (the upstream `type` in the
      // snapshot below is the source of truth for shared vs. standard).
      // The "shared" string should still appear via the rendered provider
      // type in the JSON snapshot, never via a request-side claim.
      expect(text).toContain('"type": "shared"');
      expect(text).toContain('"oauth_providers"');
      // Focused response — must NOT include the full settings snapshot.
      expect(text).not.toContain('"trusted_origins"');
      expect(text).not.toContain('"auth_methods"');
    }
  });

  it('add_oauth_provider in standard mode passes BYO credentials and never echoes the secret', async () => {
    const addBranchNeonAuthOauthProvider = vi
      .fn()
      .mockResolvedValue({ status: 201 });
    const neonClient = {
      ...defaultSnapshotMocks(),
      listProjectBranches: vi.fn().mockResolvedValue({
        data: { branches: [{ id: 'br-default', default: true }] },
      }),
      addBranchNeonAuthOauthProvider,
      listBranchNeonAuthOauthProviders: vi.fn().mockResolvedValue({
        status: 200,
        data: {
          providers: [
            {
              id: 'github',
              type: 'standard',
              client_id: 'gh-app-id',
              client_secret: 'sentinel-from-upstream',
            },
          ],
        },
      }),
    };

    const result = await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'add_oauth_provider',
        projectId: 'proj-1',
        oauth_provider: 'github',
        oauth_provider_config: {
          client_id: 'gh-app-id',
          client_secret: 'caller-supplied-secret',
        },
      }),
      neonClient as never,
      extra,
    );

    expect(result.isError).toBeFalsy();
    expect(addBranchNeonAuthOauthProvider).toHaveBeenCalledWith(
      'proj-1',
      'br-default',
      {
        id: 'github',
        client_id: 'gh-app-id',
        client_secret: 'caller-supplied-secret',
      },
    );
    if (result.content[0].type === 'text') {
      const text = result.content[0].text;
      // Snapshot must redact, never echoing either upstream's value or the
      // caller-supplied value back in the rendered response.
      expect(text).toContain(REDACTED_SECRET);
      expect(text).not.toContain('caller-supplied-secret');
      expect(text).not.toContain('sentinel-from-upstream');
      // client_id is allowed to be visible.
      expect(text).toContain('gh-app-id');
    }
  });

  it('update_oauth_provider sends only the fields the caller provided (partial patch)', async () => {
    const updateBranchNeonAuthOauthProvider = vi
      .fn()
      .mockResolvedValue({ status: 200 });
    const neonClient = {
      ...defaultSnapshotMocks(),
      updateBranchNeonAuthOauthProvider,
    };

    await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'update_oauth_provider',
        projectId: 'proj-1',
        branchId: 'br-1',
        oauth_provider: 'microsoft',
        oauth_provider_config: { microsoft_tenant_id: 'tenant-xyz' },
      }),
      neonClient as never,
      extra,
    );

    expect(updateBranchNeonAuthOauthProvider).toHaveBeenCalledWith(
      'proj-1',
      'br-1',
      'microsoft',
      { microsoft_tenant_id: 'tenant-xyz' },
    );
  });

  it('remove_oauth_provider calls deleteBranchNeonAuthOauthProvider and accepts 204', async () => {
    const deleteBranchNeonAuthOauthProvider = vi
      .fn()
      .mockResolvedValue({ status: 204 });
    const neonClient = {
      ...defaultSnapshotMocks(),
      deleteBranchNeonAuthOauthProvider,
    };

    const result = await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'remove_oauth_provider',
        projectId: 'proj-1',
        branchId: 'br-1',
        oauth_provider: 'vercel',
      }),
      neonClient as never,
      extra,
    );

    expect(result.isError).toBeFalsy();
    expect(deleteBranchNeonAuthOauthProvider).toHaveBeenCalledWith(
      'proj-1',
      'br-1',
      'vercel',
    );
    if (result.content[0].type === 'text') {
      expect(result.content[0].text).toContain(
        'Requested remove of OAuth provider vercel',
      );
    }
  });

  // Email provider + test email handler tests --------------------------------

  it('update_email_provider passes the discriminated union through and renders an email-only summary with redacted password', async () => {
    const updateNeonAuthEmailProvider = vi
      .fn()
      .mockResolvedValue({ status: 200 });
    const neonClient = {
      ...defaultSnapshotMocks(),
      updateNeonAuthEmailProvider,
      // Override the default 'shared' fixture so the focused summary
      // exercises the standard/redaction code path.
      getNeonAuthEmailProvider: vi.fn().mockResolvedValue({
        status: 200,
        data: {
          type: 'standard',
          host: 'smtp.sendgrid.net',
          port: 587,
          username: 'apikey',
          password: 'sentinel-from-upstream',
          sender_email: 'noreply@example.com',
          sender_name: 'Acme',
        },
      }),
    };

    const result = await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'update_email_provider',
        projectId: 'proj-1',
        branchId: 'br-1',
        email_provider: {
          type: 'standard',
          host: 'smtp.sendgrid.net',
          port: 587,
          username: 'apikey',
          password: 'caller-supplied-password',
          sender_email: 'noreply@example.com',
          sender_name: 'Acme',
        },
      }),
      neonClient as never,
      extra,
    );

    expect(result.isError).toBeFalsy();
    expect(updateNeonAuthEmailProvider).toHaveBeenCalledWith('proj-1', 'br-1', {
      type: 'standard',
      host: 'smtp.sendgrid.net',
      port: 587,
      username: 'apikey',
      password: 'caller-supplied-password',
      sender_email: 'noreply@example.com',
      sender_name: 'Acme',
    });
    if (result.content[0].type === 'text') {
      const text = result.content[0].text;
      expect(text).toContain('Requested update of email provider');
      expect(text).toContain('"email_provider"');
      expect(text).toContain(REDACTED_SECRET);
      expect(text).not.toContain('sentinel-from-upstream');
      expect(text).not.toContain('caller-supplied-password');
      // Focused response — no full snapshot leakage.
      expect(text).not.toContain('"trusted_origins"');
    }
  });

  it('send_test_email passes through upstream success and does not reload the snapshot', async () => {
    const sendNeonAuthTestEmail = vi.fn().mockResolvedValue({
      status: 200,
      data: { success: true },
    });
    const listBranchNeonAuthTrustedDomains = vi.fn();
    const neonClient = {
      sendNeonAuthTestEmail,
      // Snapshot fetchers MUST NOT be invoked. We hand in spies that would
      // throw on any access to assert the no-reload contract.
      listBranchNeonAuthTrustedDomains,
      listProjectBranches: vi.fn().mockResolvedValue({
        data: { branches: [{ id: 'br-default', default: true }] },
      }),
      // The integration probe is intentionally NOT a snapshot fetcher; it
      // gates whether the operation runs at all. Returning 200 here lets the
      // dispatch happen so we can still assert the no-snapshot-reload
      // contract on the snapshot fetchers below.
      getNeonAuth: vi.fn().mockResolvedValue({ status: 200, data: {} }),
    };

    const result = await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'send_test_email',
        projectId: 'proj-1',
        test_email: {
          recipient_email: 'tester@example.com',
          host: 'smtp.example.com',
          port: 587,
          username: 'apikey',
          password: 'secret',
          sender_email: 'noreply@example.com',
          sender_name: 'Acme',
        },
      }),
      neonClient as never,
      extra,
    );

    expect(result.isError).toBeFalsy();
    expect(sendNeonAuthTestEmail).toHaveBeenCalledWith('proj-1', 'br-default', {
      recipient_email: 'tester@example.com',
      host: 'smtp.example.com',
      port: 587,
      username: 'apikey',
      password: 'secret',
      sender_email: 'noreply@example.com',
      sender_name: 'Acme',
    });
    expect(listBranchNeonAuthTrustedDomains).not.toHaveBeenCalled();
    if (result.content[0].type === 'text') {
      const text = result.content[0].text;
      expect(text).toContain('Test email dispatched to tester@example.com');
      // Defense-in-depth: the supplied SMTP password must never surface in
      // the rendered output, even on the success path.
      expect(text).not.toContain('secret');
    }
  });

  it('send_test_email surfaces upstream failures via isError and the upstream error message', async () => {
    const sendNeonAuthTestEmail = vi.fn().mockResolvedValue({
      status: 200,
      data: { success: false, error_message: 'auth failed: 535' },
    });
    const neonClient = {
      sendNeonAuthTestEmail,
      listProjectBranches: vi.fn().mockResolvedValue({
        data: { branches: [{ id: 'br-default', default: true }] },
      }),
      // Satisfy the `ensureNeonAuthProvisioned` prereq probe.
      getNeonAuth: vi.fn().mockResolvedValue({ status: 200, data: {} }),
    };

    const result = await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'send_test_email',
        projectId: 'proj-1',
        test_email: {
          recipient_email: 'tester@example.com',
          host: 'smtp.example.com',
          port: 587,
          username: 'apikey',
          password: 'wrong',
          sender_email: 'noreply@example.com',
          sender_name: 'Acme',
        },
      }),
      neonClient as never,
      extra,
    );

    expect(result.isError).toBe(true);
    if (result.content[0].type === 'text') {
      const text = result.content[0].text;
      expect(text).toContain(
        'Test email could NOT be sent to tester@example.com',
      );
      expect(text).toContain('auth failed: 535');
      // Defense-in-depth: the wrong password must never surface in the
      // rendered failure message either.
      expect(text).not.toContain('wrong');
    }
  });

  // Item #8: idempotent re-add / re-remove paths --------------------------

  it('add_oauth_provider accepts an idempotent 200 (re-add of an already-configured provider)', async () => {
    // Upstream returns 201 for a fresh add and 200 for a re-add. The handler
    // accepts both so a benign re-issue does not surface as a failure.
    const addBranchNeonAuthOauthProvider = vi
      .fn()
      .mockResolvedValue({ status: 200 });
    const neonClient = {
      ...defaultSnapshotMocks(),
      addBranchNeonAuthOauthProvider,
      listBranchNeonAuthOauthProviders: vi.fn().mockResolvedValue({
        status: 200,
        data: { providers: [{ id: 'google', type: 'shared' }] },
      }),
    };

    const result = await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'add_oauth_provider',
        projectId: 'proj-1',
        branchId: 'br-1',
        oauth_provider: 'google',
      }),
      neonClient as never,
      extra,
    );

    expect(result.isError).toBeFalsy();
    if (result.content[0].type === 'text') {
      expect(result.content[0].text).toContain(
        'Requested add of OAuth provider google',
      );
    }
  });

  it('remove_oauth_provider accepts an idempotent 200 (re-remove of an already-absent provider)', async () => {
    const deleteBranchNeonAuthOauthProvider = vi
      .fn()
      .mockResolvedValue({ status: 200 });
    const neonClient = {
      ...defaultSnapshotMocks(),
      deleteBranchNeonAuthOauthProvider,
    };

    const result = await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'remove_oauth_provider',
        projectId: 'proj-1',
        branchId: 'br-1',
        oauth_provider: 'github',
      }),
      neonClient as never,
      extra,
    );

    expect(result.isError).toBeFalsy();
    if (result.content[0].type === 'text') {
      expect(result.content[0].text).toContain(
        'Requested remove of OAuth provider github',
      );
    }
  });

  // Item #5: defense-in-depth secret redaction on update_oauth_provider ----

  it('update_oauth_provider redacts both caller-supplied and upstream client_secret in the rendered slice', async () => {
    const updateBranchNeonAuthOauthProvider = vi
      .fn()
      .mockResolvedValue({ status: 200 });
    const neonClient = {
      ...defaultSnapshotMocks(),
      updateBranchNeonAuthOauthProvider,
      listBranchNeonAuthOauthProviders: vi.fn().mockResolvedValue({
        status: 200,
        data: {
          providers: [
            {
              id: 'github',
              type: 'standard',
              client_id: 'gh-app-id',
              client_secret: 'sentinel-from-upstream-update',
            },
          ],
        },
      }),
    };

    const result = await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'update_oauth_provider',
        projectId: 'proj-1',
        branchId: 'br-1',
        oauth_provider: 'github',
        oauth_provider_config: {
          client_secret: 'caller-supplied-update-secret',
        },
      }),
      neonClient as never,
      extra,
    );

    expect(result.isError).toBeFalsy();
    if (result.content[0].type === 'text') {
      const text = result.content[0].text;
      expect(text).toContain(REDACTED_SECRET);
      expect(text).not.toContain('caller-supplied-update-secret');
      expect(text).not.toContain('sentinel-from-upstream-update');
      expect(text).toContain('gh-app-id');
    }
  });

  // Item #6: handler exercise of the type='shared' email provider branch --

  it('update_email_provider passes the shared discriminator through verbatim', async () => {
    const updateNeonAuthEmailProvider = vi
      .fn()
      .mockResolvedValue({ status: 200 });
    const neonClient = {
      ...defaultSnapshotMocks(),
      updateNeonAuthEmailProvider,
      getNeonAuthEmailProvider: vi.fn().mockResolvedValue({
        status: 200,
        data: {
          type: 'shared',
          sender_email: 'noreply@example.com',
          sender_name: 'Acme',
        },
      }),
    };

    const result = await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'update_email_provider',
        projectId: 'proj-1',
        branchId: 'br-1',
        email_provider: {
          type: 'shared',
          sender_email: 'noreply@example.com',
          sender_name: 'Acme',
        },
      }),
      neonClient as never,
      extra,
    );

    expect(result.isError).toBeFalsy();
    expect(updateNeonAuthEmailProvider).toHaveBeenCalledWith('proj-1', 'br-1', {
      type: 'shared',
      sender_email: 'noreply@example.com',
      sender_name: 'Acme',
    });
    if (result.content[0].type === 'text') {
      const text = result.content[0].text;
      expect(text).toContain(
        'Requested update of email provider (type=shared)',
      );
      expect(text).toContain('"type": "shared"');
      // Shared mode has no SMTP password, so no redaction sentinel should
      // be needed in the rendered slice.
      expect(text).not.toContain(REDACTED_SECRET);
    }
  });

  // Item #4: post-mutation reconciliation warnings -----------------------

  it('add_oauth_provider warns when the just-added provider is absent from the post-write list (race detection)', async () => {
    const addBranchNeonAuthOauthProvider = vi
      .fn()
      .mockResolvedValue({ status: 201 });
    const neonClient = {
      ...defaultSnapshotMocks(),
      addBranchNeonAuthOauthProvider,
      // Concurrent delete races between PATCH and GET — the just-added
      // provider is missing from the post-write list.
      listBranchNeonAuthOauthProviders: vi.fn().mockResolvedValue({
        status: 200,
        data: { providers: [] },
      }),
    };

    const result = await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'add_oauth_provider',
        projectId: 'proj-1',
        branchId: 'br-1',
        oauth_provider: 'google',
      }),
      neonClient as never,
      extra,
    );

    // Soft inconsistency: the upstream write was acknowledged, so we do
    // NOT flip isError, but we DO surface a warning so callers don't read
    // the empty slice as "the change silently undid itself".
    expect(result.isError).toBeFalsy();
    if (result.content[0].type === 'text') {
      const text = result.content[0].text;
      expect(text).toContain('WARNING:');
      expect(text).toContain('"google"');
      expect(text).toContain('absent from the post-write provider list');
    }
  });

  it('remove_oauth_provider warns when the just-removed provider is still present in the post-write list (race detection)', async () => {
    const deleteBranchNeonAuthOauthProvider = vi
      .fn()
      .mockResolvedValue({ status: 204 });
    const neonClient = {
      ...defaultSnapshotMocks(),
      deleteBranchNeonAuthOauthProvider,
      listBranchNeonAuthOauthProviders: vi.fn().mockResolvedValue({
        status: 200,
        data: {
          providers: [
            {
              id: 'github',
              type: 'standard',
              client_id: 'gh-app-id',
            },
          ],
        },
      }),
    };

    const result = await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'remove_oauth_provider',
        projectId: 'proj-1',
        branchId: 'br-1',
        oauth_provider: 'github',
      }),
      neonClient as never,
      extra,
    );

    expect(result.isError).toBeFalsy();
    if (result.content[0].type === 'text') {
      const text = result.content[0].text;
      expect(text).toContain('WARNING:');
      expect(text).toContain('still present in the post-write provider list');
    }
  });

  it('update_email_provider warns when the post-write snapshot reports no provider (race detection)', async () => {
    const updateNeonAuthEmailProvider = vi
      .fn()
      .mockResolvedValue({ status: 200 });
    const axiosError404 = Object.assign(
      new Error('Request failed with status code 404'),
      {
        isAxiosError: true,
        response: { status: 404, statusText: 'Not Found' },
      },
    );
    const neonClient = {
      ...defaultSnapshotMocks(),
      updateNeonAuthEmailProvider,
      // Concurrent delete (or extreme propagation lag) between PATCH and
      // GET surfaces the email provider as 404 right after we PATCHed it.
      getNeonAuthEmailProvider: vi.fn().mockRejectedValue(axiosError404),
    };

    const result = await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'update_email_provider',
        projectId: 'proj-1',
        branchId: 'br-1',
        email_provider: { type: 'shared' },
      }),
      neonClient as never,
      extra,
    );

    expect(result.isError).toBeFalsy();
    if (result.content[0].type === 'text') {
      const text = result.content[0].text;
      expect(text).toContain('WARNING:');
      expect(text).toContain('absent from the post-write snapshot');
      expect(text).toContain('"email_provider": null');
    }
  });

  // Item #7: HTTP non-success branches for the five new ops ---------------
  // These exercise the resolved-non-200 path, which is defensive against
  // future SDK config changes — axios's default validateStatus throws on
  // 4xx/5xx today, so most non-200 responses propagate through the outer
  // error wrapper. We still lock the in-handler shape so the contract is
  // explicit and stable.

  it('add_oauth_provider returns isError=true on resolved 5xx', async () => {
    const neonClient = {
      ...defaultSnapshotMocks(),
      addBranchNeonAuthOauthProvider: vi.fn().mockResolvedValue({
        status: 500,
        statusText: 'Internal Server Error',
      }),
    };

    const result = await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'add_oauth_provider',
        projectId: 'proj-1',
        branchId: 'br-1',
        oauth_provider: 'google',
      }),
      neonClient as never,
      extra,
    );

    expect(result.isError).toBe(true);
    if (result.content[0].type === 'text') {
      expect(result.content[0].text).toContain(
        'Failed to add OAuth provider google (500',
      );
    }
  });

  it('update_oauth_provider returns isError=true on resolved 5xx', async () => {
    const neonClient = {
      ...defaultSnapshotMocks(),
      updateBranchNeonAuthOauthProvider: vi.fn().mockResolvedValue({
        status: 500,
        statusText: 'Internal Server Error',
      }),
    };

    const result = await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'update_oauth_provider',
        projectId: 'proj-1',
        branchId: 'br-1',
        oauth_provider: 'google',
        oauth_provider_config: { client_id: 'gid' },
      }),
      neonClient as never,
      extra,
    );

    expect(result.isError).toBe(true);
    if (result.content[0].type === 'text') {
      expect(result.content[0].text).toContain(
        'Failed to update OAuth provider google (500',
      );
    }
  });

  it('remove_oauth_provider returns isError=true on resolved 5xx', async () => {
    const neonClient = {
      ...defaultSnapshotMocks(),
      deleteBranchNeonAuthOauthProvider: vi.fn().mockResolvedValue({
        status: 500,
        statusText: 'Internal Server Error',
      }),
    };

    const result = await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'remove_oauth_provider',
        projectId: 'proj-1',
        branchId: 'br-1',
        oauth_provider: 'google',
      }),
      neonClient as never,
      extra,
    );

    expect(result.isError).toBe(true);
    if (result.content[0].type === 'text') {
      expect(result.content[0].text).toContain(
        'Failed to remove OAuth provider google (500',
      );
    }
  });

  it('update_email_provider returns isError=true on resolved 5xx', async () => {
    const neonClient = {
      ...defaultSnapshotMocks(),
      updateNeonAuthEmailProvider: vi.fn().mockResolvedValue({
        status: 500,
        statusText: 'Internal Server Error',
      }),
    };

    const result = await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'update_email_provider',
        projectId: 'proj-1',
        branchId: 'br-1',
        email_provider: { type: 'shared' },
      }),
      neonClient as never,
      extra,
    );

    expect(result.isError).toBe(true);
    if (result.content[0].type === 'text') {
      expect(result.content[0].text).toContain(
        'Failed to update email provider (500',
      );
    }
  });

  it('send_test_email returns isError=true on resolved 5xx and surfaces upstream error_message when present', async () => {
    const neonClient = {
      ...defaultSnapshotMocks(),
      sendNeonAuthTestEmail: vi.fn().mockResolvedValue({
        status: 500,
        statusText: 'Internal Server Error',
        data: { error_message: 'upstream relay refused' },
      }),
    };

    const result = await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'send_test_email',
        projectId: 'proj-1',
        branchId: 'br-1',
        test_email: {
          recipient_email: 'tester@example.com',
          host: 'smtp.example.com',
          port: 587,
          username: 'apikey',
          password: 'sensitive-password',
          sender_email: 'noreply@example.com',
          sender_name: 'Acme',
        },
      }),
      neonClient as never,
      extra,
    );

    expect(result.isError).toBe(true);
    if (result.content[0].type === 'text') {
      const text = result.content[0].text;
      expect(text).toContain('Failed to dispatch test email request (500');
      // Item #3: the resolved-non-200 path must include the upstream
      // error_message when the upstream body carries one.
      expect(text).toContain('upstream relay refused');
      // S5: the supplied SMTP password must never surface, even on this
      // branch.
      expect(text).not.toContain('sensitive-password');
    }
  });
});

describe('handleConfigureNeonAuth prerequisite probe', () => {
  // The configure handler runs `ensureNeonAuthProvisioned` BEFORE dispatching
  // any operation. A 404 on the integration probe definitively means the
  // branch has no Neon Auth integration, so we return a prescriptive
  // "ask the user before calling provision_neon_auth" message and short-
  // circuit before invoking the per-operation SDK method. This avoids two
  // failure modes:
  //   1. Letting the LLM see a generic per-op 404 string and chain into
  //      provision_neon_auth automatically (provisioning has side effects).
  //   2. Conflating "Neon Auth not provisioned" with op-meaningful 404s
  //      (e.g. unknown OAuth provider id on update_oauth_provider).

  it('short-circuits add_trusted_origin (PR1 op) with approval-gate message and does NOT call the mutation SDK', async () => {
    const addBranchNeonAuthTrustedDomain = vi.fn();
    const neonClient = {
      ...defaultSnapshotMocks(),
      // Override: branch has no Neon Auth integration.
      getNeonAuth: vi.fn().mockResolvedValue({ status: 404 }),
      addBranchNeonAuthTrustedDomain,
    };

    const result = await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'add_trusted_origin',
        projectId: 'proj-1',
        branchId: 'br-1',
        trusted_origin: 'https://app.example.com/auth/callback',
      }),
      neonClient as never,
      extra,
    );

    expect(result.isError).toBe(true);
    if (result.content[0].type === 'text') {
      const text = result.content[0].text;
      expect(text).toContain('Neon Auth is not provisioned');
      expect(text).toContain('HTTP 404');
      // Approval-gate wording — the LLM must surface the prereq to the user
      // and obtain explicit consent before calling provision_neon_auth.
      expect(text).toContain('ask the user');
      expect(text).toContain('explicit approval');
      expect(text).toContain('side effects');
      expect(text).toContain('provision_neon_auth');
    }
    // Defence-in-depth: the per-op SDK mutation must NOT be called.
    // A future regression that calls the mutation first would still flow
    // through the 404 path, but we insist on the short-circuit so callers
    // never observe partial / ambiguous mutation attempts on an
    // unprovisioned branch.
    expect(addBranchNeonAuthTrustedDomain).not.toHaveBeenCalled();
  });

  it('short-circuits add_oauth_provider (PR2 op) with approval-gate message and does NOT call the mutation SDK', async () => {
    const addBranchNeonAuthOauthProvider = vi.fn();
    const neonClient = {
      ...defaultSnapshotMocks(),
      getNeonAuth: vi.fn().mockResolvedValue({ status: 404 }),
      addBranchNeonAuthOauthProvider,
    };

    const result = await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'add_oauth_provider',
        projectId: 'proj-1',
        branchId: 'br-1',
        oauth_provider: 'google',
      }),
      neonClient as never,
      extra,
    );

    expect(result.isError).toBe(true);
    if (result.content[0].type === 'text') {
      const text = result.content[0].text;
      expect(text).toContain('Neon Auth is not provisioned');
      expect(text).toContain('ask the user');
      expect(text).toContain('explicit approval');
    }
    expect(addBranchNeonAuthOauthProvider).not.toHaveBeenCalled();
  });

  it('returns a generic verify-failed message (not the approval-gate one) when getNeonAuth fails with non-404', async () => {
    const addBranchNeonAuthTrustedDomain = vi.fn();
    const neonClient = {
      ...defaultSnapshotMocks(),
      getNeonAuth: vi.fn().mockResolvedValue({
        status: 500,
        statusText: 'Internal Server Error',
      }),
      addBranchNeonAuthTrustedDomain,
    };

    const result = await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'add_trusted_origin',
        projectId: 'proj-1',
        branchId: 'br-1',
        trusted_origin: 'https://app.example.com/auth/callback',
      }),
      neonClient as never,
      extra,
    );

    expect(result.isError).toBe(true);
    if (result.content[0].type === 'text') {
      const text = result.content[0].text;
      expect(text).toContain('Failed to verify Neon Auth provisioning (500');
      expect(text).toContain('Internal Server Error');
      // Critical: a generic upstream failure must NOT be misrepresented as
      // "not provisioned". That would steer the LLM toward suggesting
      // provisioning when the actual problem is something else (e.g. an
      // outage). Keep the two paths distinct.
      expect(text).not.toContain('ask the user');
      expect(text).not.toContain('side effects');
    }
    expect(addBranchNeonAuthTrustedDomain).not.toHaveBeenCalled();
  });
});
