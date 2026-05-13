import { describe, it, expect, vi } from 'vitest';
import { NeonAuthEmailVerificationMethod } from '@neondatabase/api-client';

// Mock node:dns/promises BEFORE importing the handler. The handler captures
// the `dns` namespace on import; patching the module after-the-fact has no
// effect. Default the lookup to a public-looking IP so unrelated webhook
// tests are not affected; the SSRF test below overrides it per-call.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));
import * as dnsPromises from 'node:dns/promises';
const mockedDnsLookup = dnsPromises.lookup as unknown as ReturnType<
  typeof vi.fn
>;
import { configureNeonAuthInputSchema } from '../tools/toolsSchema';
import {
  buildMagicLinkPatch,
  buildPhoneNumberPatch,
  buildOrganizationPatch,
  handleConfigureNeonAuth,
} from '../tools/handlers/neon-auth-config';
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

function snapshotMocks() {
  return {
    listProjectBranches: vi.fn().mockResolvedValue({
      data: { branches: [{ id: 'br-default', default: true }] },
    }),
    listBranchNeonAuthTrustedDomains: vi
      .fn()
      .mockResolvedValue({ status: 200, data: { domains: [] } }),
    getNeonAuthAllowLocalhost: vi
      .fn()
      .mockResolvedValue({ status: 200, data: { allow_localhost: false } }),
    getNeonAuthEmailAndPasswordConfig: vi
      .fn()
      .mockResolvedValue({ status: 200, data: EMAIL_PASSWORD_DEFAULTS }),
    getNeonAuthPluginConfigs: vi
      .fn()
      .mockResolvedValue({ status: 200, data: {} }),
    getNeonAuthWebhookConfig: vi
      .fn()
      .mockResolvedValue({ status: 404, statusText: 'Not Found' }),
    getNeonAuthEmailServer: vi
      .fn()
      .mockResolvedValue({ status: 404, statusText: 'Not Found' }),
  };
}

describe('build*Patch builders', () => {
  it('buildMagicLinkPatch maps allow_sign_up → !disable_sign_up and expires_in_minutes → expires_in', () => {
    expect(
      buildMagicLinkPatch({
        enabled: true,
        allow_sign_up: false,
        expires_in_minutes: 30,
      }),
    ).toEqual({ enabled: true, disable_sign_up: true, expires_in: 30 });
  });

  it('buildMagicLinkPatch omits undefined fields', () => {
    expect(buildMagicLinkPatch({ enabled: false })).toEqual({ enabled: false });
    expect(buildMagicLinkPatch({})).toEqual({});
  });

  it('buildPhoneNumberPatch maps otp_expires_in_seconds → otp_expires_in', () => {
    expect(
      buildPhoneNumberPatch({ enabled: true, otp_expires_in_seconds: 120 }),
    ).toEqual({ enabled: true, otp_expires_in: 120 });
  });

  it('buildPhoneNumberPatch omits undefined fields', () => {
    expect(buildPhoneNumberPatch({})).toEqual({});
  });

  it('buildOrganizationPatch passes through all fields by name', () => {
    expect(
      buildOrganizationPatch({
        enabled: true,
        organization_limit: 5,
        membership_limit: 50,
        creator_role: 'admin',
        send_invitation_email: true,
      }),
    ).toEqual({
      enabled: true,
      organization_limit: 5,
      membership_limit: 50,
      creator_role: 'admin',
      send_invitation_email: true,
    });
  });

  it('buildOrganizationPatch omits undefined fields', () => {
    expect(buildOrganizationPatch({ creator_role: 'owner' })).toEqual({
      creator_role: 'owner',
    });
  });
});

describe('configureNeonAuthInputSchema – update_plugin', () => {
  it('rejects update_plugin with no plugin', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_plugin',
      projectId: 'p1',
      plugin_patch: { enabled: true },
    });
    expect(r.success).toBe(false);
  });

  it('rejects update_plugin with no plugin_patch', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_plugin',
      projectId: 'p1',
      plugin: 'magic_link',
    });
    expect(r.success).toBe(false);
  });

  it('rejects update_plugin with empty plugin_patch', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_plugin',
      projectId: 'p1',
      plugin: 'magic_link',
      plugin_patch: {},
    });
    expect(r.success).toBe(false);
  });

  it('accepts magic_link with allow_sign_up only', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_plugin',
      projectId: 'p1',
      plugin: 'magic_link',
      plugin_patch: { allow_sign_up: true },
    });
    expect(r.success).toBe(true);
  });

  it('rejects magic_link with phone_number-shaped patch', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_plugin',
      projectId: 'p1',
      plugin: 'magic_link',
      plugin_patch: { otp_expires_in_seconds: 120 },
    });
    expect(r.success).toBe(false);
  });

  it('rejects organization with bogus creator_role', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_plugin',
      projectId: 'p1',
      plugin: 'organization',
      plugin_patch: { creator_role: 'superuser' },
    });
    expect(r.success).toBe(false);
  });

  it('rejects magic_link with expires_in_minutes out of range', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_plugin',
      projectId: 'p1',
      plugin: 'magic_link',
      plugin_patch: { expires_in_minutes: 9999 },
    });
    expect(r.success).toBe(false);
  });

  it('rejects phone_number with otp_expires_in_seconds below 60', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_plugin',
      projectId: 'p1',
      plugin: 'phone_number',
      plugin_patch: { otp_expires_in_seconds: 30 },
    });
    expect(r.success).toBe(false);
  });
});

describe('configureNeonAuthInputSchema – update_webhook_config', () => {
  it('rejects update_webhook_config without webhook block', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_webhook_config',
      projectId: 'p1',
    });
    expect(r.success).toBe(false);
  });

  it('rejects update_webhook_config with empty webhook block', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_webhook_config',
      projectId: 'p1',
      webhook: {},
    });
    expect(r.success).toBe(false);
  });

  it('rejects http:// webhook_url', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_webhook_config',
      projectId: 'p1',
      webhook: { webhook_url: 'http://example.com/hook' },
      confirm_dangerous_change: true,
    });
    expect(r.success).toBe(false);
  });

  it('rejects webhook_url with embedded credentials', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_webhook_config',
      projectId: 'p1',
      webhook: { webhook_url: 'https://user:pass@example.com/hook' },
      confirm_dangerous_change: true,
    });
    expect(r.success).toBe(false);
  });

  it.each([
    ['localhost', 'https://localhost/hook'],
    ['127.0.0.1', 'https://127.0.0.1/hook'],
    ['10/8 private', 'https://10.0.0.5/hook'],
    ['172.16/12 private', 'https://172.20.0.1/hook'],
    ['192.168/16 private', 'https://192.168.1.1/hook'],
    ['link-local 169.254', 'https://169.254.169.254/'],
    ['IPv6 loopback', 'https://[::1]/hook'],
    ['cloud metadata host', 'https://metadata.google.internal/hook'],
  ])('rejects webhook_url pointing at %s (%s)', (_label, url) => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_webhook_config',
      projectId: 'p1',
      webhook: { webhook_url: url },
      confirm_dangerous_change: true,
    });
    expect(r.success).toBe(false);
  });

  it('rejects webhook_url change without confirm_dangerous_change', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_webhook_config',
      projectId: 'p1',
      webhook: { webhook_url: 'https://hooks.example.com/auth' },
    });
    expect(r.success).toBe(false);
  });

  it('accepts webhook_url change WITH confirm_dangerous_change', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_webhook_config',
      projectId: 'p1',
      webhook: { webhook_url: 'https://hooks.example.com/auth' },
      confirm_dangerous_change: true,
    });
    expect(r.success).toBe(true);
  });

  it('accepts toggling enabled without confirm_dangerous_change', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_webhook_config',
      projectId: 'p1',
      webhook: { enabled: false },
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown event in enabled_events', () => {
    const r = configureNeonAuthInputSchema.safeParse({
      operation: 'update_webhook_config',
      projectId: 'p1',
      webhook: {
        enabled_events: ['user.created', 'user.deleted'] as never,
      },
    });
    expect(r.success).toBe(false);
  });
});

describe('handleConfigureNeonAuth – update_plugin', () => {
  it('magic_link: routes to updateNeonAuthMagicLinkPlugin with mapped patch', async () => {
    const updateNeonAuthMagicLinkPlugin = vi
      .fn()
      .mockResolvedValue({ status: 200, data: {} });
    const neonClient = {
      ...snapshotMocks(),
      updateNeonAuthMagicLinkPlugin,
    };
    const result = await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'update_plugin',
        projectId: 'p1',
        branchId: 'br-1',
        plugin: 'magic_link',
        plugin_patch: {
          enabled: true,
          allow_sign_up: false,
          expires_in_minutes: 15,
        },
      }),
      neonClient as never,
      extra,
    );
    expect(result.isError).toBeFalsy();
    expect(updateNeonAuthMagicLinkPlugin).toHaveBeenCalledWith('p1', 'br-1', {
      enabled: true,
      disable_sign_up: true,
      expires_in: 15,
    });
  });

  it('phone_number: routes to updateNeonAuthPhoneNumberPlugin', async () => {
    const updateNeonAuthPhoneNumberPlugin = vi
      .fn()
      .mockResolvedValue({ status: 200, data: {} });
    const neonClient = {
      ...snapshotMocks(),
      updateNeonAuthPhoneNumberPlugin,
    };
    const result = await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'update_plugin',
        projectId: 'p1',
        branchId: 'br-1',
        plugin: 'phone_number',
        plugin_patch: { enabled: true, otp_expires_in_seconds: 90 },
      }),
      neonClient as never,
      extra,
    );
    expect(result.isError).toBeFalsy();
    expect(updateNeonAuthPhoneNumberPlugin).toHaveBeenCalledWith('p1', 'br-1', {
      enabled: true,
      otp_expires_in: 90,
    });
  });

  it('organization: routes to updateNeonAuthOrganizationPlugin', async () => {
    const updateNeonAuthOrganizationPlugin = vi
      .fn()
      .mockResolvedValue({ status: 200, data: {} });
    const neonClient = {
      ...snapshotMocks(),
      updateNeonAuthOrganizationPlugin,
    };
    const result = await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'update_plugin',
        projectId: 'p1',
        branchId: 'br-1',
        plugin: 'organization',
        plugin_patch: { creator_role: 'admin', organization_limit: 3 },
      }),
      neonClient as never,
      extra,
    );
    expect(result.isError).toBeFalsy();
    expect(updateNeonAuthOrganizationPlugin).toHaveBeenCalledWith(
      'p1',
      'br-1',
      { creator_role: 'admin', organization_limit: 3 },
    );
  });

  it('refuses to disable last sign-in method without confirm_dangerous_change', async () => {
    const neonClient = {
      ...snapshotMocks(),
      // email_password is the only enabled method, plugins are off (default mocks)
      getNeonAuthEmailAndPasswordConfig: vi.fn().mockResolvedValue({
        status: 200,
        data: { ...EMAIL_PASSWORD_DEFAULTS, enabled: true },
      }),
      getNeonAuthPluginConfigs: vi.fn().mockResolvedValue({
        status: 200,
        data: {
          magic_link: { enabled: true, expires_in: 5, disable_sign_up: false },
          phone_number: { enabled: false },
        },
      }),
      updateNeonAuthMagicLinkPlugin: vi.fn(),
    };
    // Caller simultaneously: email_password=true is in current state but
    // we're asking to disable magic_link, leaving 1 (email_password). That's
    // fine. To force a lockout, mark email_password as disabled in the
    // current state and disable magic_link too.
    neonClient.getNeonAuthEmailAndPasswordConfig = vi.fn().mockResolvedValue({
      status: 200,
      data: { ...EMAIL_PASSWORD_DEFAULTS, enabled: false },
    });

    const result = await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'update_plugin',
        projectId: 'p1',
        plugin: 'magic_link',
        plugin_patch: { enabled: false },
      }),
      neonClient as never,
      extra,
    );
    expect(result.isError).toBe(true);
    if (result.content[0].type === 'text') {
      expect(result.content[0].text).toMatch(/last enabled sign-in method/);
    }
    expect(neonClient.updateNeonAuthMagicLinkPlugin).not.toHaveBeenCalled();
  });

  it('allows disabling last sign-in method WITH confirm_dangerous_change', async () => {
    const updateNeonAuthMagicLinkPlugin = vi
      .fn()
      .mockResolvedValue({ status: 200, data: {} });
    const neonClient = {
      ...snapshotMocks(),
      getNeonAuthEmailAndPasswordConfig: vi.fn().mockResolvedValue({
        status: 200,
        data: { ...EMAIL_PASSWORD_DEFAULTS, enabled: false },
      }),
      updateNeonAuthMagicLinkPlugin,
    };
    const result = await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'update_plugin',
        projectId: 'p1',
        plugin: 'magic_link',
        plugin_patch: { enabled: false },
        confirm_dangerous_change: true,
      }),
      neonClient as never,
      extra,
    );
    expect(result.isError).toBeFalsy();
    expect(updateNeonAuthMagicLinkPlugin).toHaveBeenCalled();
  });
});

describe('handleConfigureNeonAuth – update_webhook_config', () => {
  it('merges patch with current config (singleton PUT)', async () => {
    const updateNeonAuthWebhookConfig = vi
      .fn()
      .mockResolvedValue({ status: 200, data: {} });
    const getNeonAuthWebhookConfig = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        enabled: true,
        webhook_url: 'https://existing.example.com/hook',
        enabled_events: ['user.created'],
        timeout_seconds: 5,
      },
    });
    const neonClient = {
      ...snapshotMocks(),
      getNeonAuthWebhookConfig,
      updateNeonAuthWebhookConfig,
    };
    const result = await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'update_webhook_config',
        projectId: 'p1',
        branchId: 'br-1',
        webhook: { timeout_seconds: 8 },
      }),
      neonClient as never,
      extra,
    );
    expect(result.isError).toBeFalsy();
    // Merged: enabled/webhook_url/enabled_events from current, timeout_seconds from patch
    expect(updateNeonAuthWebhookConfig).toHaveBeenCalledWith('p1', 'br-1', {
      enabled: true,
      webhook_url: 'https://existing.example.com/hook',
      enabled_events: ['user.created'],
      timeout_seconds: 8,
    });
  });

  it('snapshot redacts webhook_url (only emits webhook_url_set)', async () => {
    const neonClient = {
      ...snapshotMocks(),
      getNeonAuthWebhookConfig: vi.fn().mockResolvedValue({
        status: 200,
        data: {
          enabled: true,
          webhook_url: 'https://hooks.secret.example.com/super-secret-path',
          enabled_events: ['user.created'],
          timeout_seconds: 5,
        },
      }),
      updateNeonAuthWebhookConfig: vi
        .fn()
        .mockResolvedValue({ status: 200, data: {} }),
    };
    const result = await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'update_webhook_config',
        projectId: 'p1',
        webhook: { enabled: false },
      }),
      neonClient as never,
      extra,
    );
    expect(result.isError).toBeFalsy();
    if (result.content[0].type === 'text') {
      const text = result.content[0].text;
      expect(text).not.toContain('hooks.secret.example.com');
      expect(text).not.toContain('super-secret-path');
      expect(text).toContain('webhook_url_set');
    }
  });

  it('rejects webhook_url that resolves to a private IP via DNS (runtime SSRF guard)', async () => {
    // The handler does `import * as dns from 'node:dns/promises'` and calls
    // `dns.lookup`. Override the mocked lookup to return a private answer
    // so the runtime SSRF guard fires even though the schema accepts the URL.
    mockedDnsLookup.mockResolvedValueOnce([{ address: '10.0.0.1', family: 4 }]);
    const neonClient = {
      ...snapshotMocks(),
      updateNeonAuthWebhookConfig: vi.fn(),
    };
    const result = await handleConfigureNeonAuth(
      configureNeonAuthInputSchema.parse({
        operation: 'update_webhook_config',
        projectId: 'p1',
        webhook: { webhook_url: 'https://internal.example.com/hook' },
        confirm_dangerous_change: true,
      }),
      neonClient as never,
      extra,
    );
    expect(result.isError).toBe(true);
    if (result.content[0].type === 'text') {
      expect(result.content[0].text).toMatch(/private address/);
    }
    expect(neonClient.updateNeonAuthWebhookConfig).not.toHaveBeenCalled();
  });
});
