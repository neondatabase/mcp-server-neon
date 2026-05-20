import { describe, it, expect, vi } from 'vitest';
import { AxiosError } from 'axios';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  NeonAuthOauthProviderId,
  NeonAuthProviderProjectOwnedBy,
  NeonAuthSupportedAuthProvider,
} from '@neondatabase/api-client';
import { handleNeonAuthProvision } from '../tools/handlers/neon-auth-provision';
import { handleNeonAuthMethodsUpdate } from '../tools/handlers/neon-auth-methods-update';
import { handleNeonAuthOauthProviderAdd } from '../tools/handlers/neon-auth-oauth-provider-add';
import { handleNeonAuthOauthProviderUpdate } from '../tools/handlers/neon-auth-oauth-provider-update';
import { handleNeonAuthOauthProviderDelete } from '../tools/handlers/neon-auth-oauth-provider-delete';
import { handleNeonAuthDomainUpdate } from '../tools/handlers/neon-auth-domain-update';
import { handleNeonAuthWebhookUpdate } from '../tools/handlers/neon-auth-webhook-update';
import { handleNeonAuthSendTestEmail } from '../tools/handlers/neon-auth-send-test-email';
import type { ToolHandlerExtraParams } from '../tools/types';

const extra = {} as ToolHandlerExtraParams;

/**
 * Extract the first text content block from a tool result. Asserts that the
 * block exists and is text-typed; throws on mismatch so callers can use the
 * returned string in `.toContain(...)` chains without `if`-narrowing.
 */
function getText(result: CallToolResult): string {
  const block = result.content[0];
  expect(block.type).toBe('text');
  return (block as { type: 'text'; text: string }).text;
}

function defaultBranchMock() {
  return {
    listProjectBranches: vi.fn().mockResolvedValue({
      data: { branches: [{ id: 'br-default', default: true }] },
    }),
    // Pre-flight probe used by ensureNeonAuthProvisioned in every non-provision
    // handler. 200 = "provisioned, proceed". Override per-test for 404 / 5xx.
    getNeonAuth: vi.fn().mockResolvedValue({ status: 200, data: {} }),
  };
}

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

// ---------------------------------------------------------------------------
// neon_auth_provision
// ---------------------------------------------------------------------------
describe('handleNeonAuthProvision', () => {
  it('treats HTTP 409 from createNeonAuth as idempotent success', async () => {
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

    const result = await handleNeonAuthProvision(
      { projectId: 'p1' },
      neonClient as never,
      extra,
    );
    expect(result.isError).toBeFalsy();
    expect(getNeonAuth).toHaveBeenCalledWith('p1', 'br-1');
    const text = getText(result);
    expect(text).toContain('Neon Auth already provisioned');
    expect(text).toContain('https://auth.example/');
  });

  it('returns success on 201 from createNeonAuth', async () => {
    const neonClient = {
      listProjectBranches: vi.fn().mockResolvedValue({
        data: { branches: [{ id: 'br-1', default: true }] },
      }),
      listProjectBranchDatabases: vi.fn().mockResolvedValue({
        data: { databases: [{ name: 'neondb', owner_name: 'u' }] },
      }),
      createNeonAuth: vi.fn().mockResolvedValue({
        status: 201,
        data: {
          base_url: 'https://auth.new/',
          jwks_url: 'https://jwks.new/',
        },
      }),
    };
    const result = await handleNeonAuthProvision(
      { projectId: 'p1' },
      neonClient as never,
      extra,
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('successfully provisioned');
    expect(text).toContain('https://auth.new/');
  });
});

// ---------------------------------------------------------------------------
// neon_auth_methods_update — happy path + partial failure
// ---------------------------------------------------------------------------
describe('handleNeonAuthMethodsUpdate', () => {
  it('fans out email_password and organizations slices on success', async () => {
    const updateNeonAuthEmailAndPasswordConfig = vi
      .fn()
      .mockResolvedValue({ status: 200, data: {} });
    const updateNeonAuthOrganizationPlugin = vi
      .fn()
      .mockResolvedValue({ status: 200, data: {} });
    const neonClient = {
      ...defaultBranchMock(),
      updateNeonAuthEmailAndPasswordConfig,
      updateNeonAuthOrganizationPlugin,
    };

    const result = await handleNeonAuthMethodsUpdate(
      {
        projectId: 'p1',
        sign_in_methods: {
          email_password: { enabled: true, allow_sign_up: false },
        },
        organizations: { enabled: true },
      },
      neonClient as never,
      extra,
    );
    expect(result.isError).toBeFalsy();
    expect(updateNeonAuthEmailAndPasswordConfig).toHaveBeenCalledWith(
      'p1',
      'br-default',
      { enabled: true, disable_sign_up: true },
    );
    expect(updateNeonAuthOrganizationPlugin).toHaveBeenCalledWith(
      'p1',
      'br-default',
      { enabled: true },
    );
    const text = getText(result);
    expect(text).toContain('Neon Auth methods updated successfully');
    expect(text).toContain('sign_in_methods.email_password');
    expect(text).toContain('organizations');
  });

  it('reports partial failure when one slice fails (mid-fan-out)', async () => {
    const neonClient = {
      ...defaultBranchMock(),
      updateNeonAuthEmailAndPasswordConfig: vi.fn().mockResolvedValue({
        status: 200,
        data: {},
      }),
      updateNeonAuthOrganizationPlugin: vi.fn().mockResolvedValue({
        status: 500,
        statusText: 'Server Error',
      }),
    };

    const result = await handleNeonAuthMethodsUpdate(
      {
        projectId: 'p1',
        sign_in_methods: { email_password: { enabled: true } },
        organizations: { enabled: true },
      },
      neonClient as never,
      extra,
    );
    expect(result.isError).toBe(true);
    const text = getText(result);
    expect(text).toContain('partially failed');
    expect(text).toContain('"sign_in_methods.email_password"');
    expect(text).toContain('"organizations"');
    expect(text).toContain('500');
  });

  it('email_password mapping inverts allow_sign_up to disable_sign_up', async () => {
    const updateNeonAuthEmailAndPasswordConfig = vi
      .fn()
      .mockResolvedValue({ status: 200, data: {} });
    const neonClient = {
      ...defaultBranchMock(),
      updateNeonAuthEmailAndPasswordConfig,
    };
    await handleNeonAuthMethodsUpdate(
      {
        projectId: 'p1',
        branchId: 'b1',
        sign_in_methods: { email_password: { allow_sign_up: false } },
      },
      neonClient as never,
      extra,
    );
    expect(updateNeonAuthEmailAndPasswordConfig).toHaveBeenCalledWith(
      'p1',
      'b1',
      { disable_sign_up: true },
    );
  });
});

// ---------------------------------------------------------------------------
// OAuth provider handlers
// ---------------------------------------------------------------------------
describe('handleNeonAuthOauthProviderAdd', () => {
  it('passes only id for shared mode', async () => {
    const addBranchNeonAuthOauthProvider = vi
      .fn()
      .mockResolvedValue({ status: 201 });
    const neonClient = {
      ...defaultBranchMock(),
      addBranchNeonAuthOauthProvider,
    };
    const result = await handleNeonAuthOauthProviderAdd(
      { projectId: 'p1', provider_id: NeonAuthOauthProviderId.Google },
      neonClient as never,
      extra,
    );
    expect(result.isError).toBeFalsy();
    expect(addBranchNeonAuthOauthProvider).toHaveBeenCalledWith(
      'p1',
      'br-default',
      { id: NeonAuthOauthProviderId.Google },
    );
  });

  it('passes BYO credentials when provided', async () => {
    const addBranchNeonAuthOauthProvider = vi
      .fn()
      .mockResolvedValue({ status: 200 });
    const neonClient = {
      ...defaultBranchMock(),
      addBranchNeonAuthOauthProvider,
    };
    await handleNeonAuthOauthProviderAdd(
      {
        projectId: 'p1',
        branchId: 'b1',
        provider_id: NeonAuthOauthProviderId.Github,
        oauth_provider_config: { client_id: 'a', client_secret: 'b' },
      },
      neonClient as never,
      extra,
    );
    expect(addBranchNeonAuthOauthProvider).toHaveBeenCalledWith('p1', 'b1', {
      id: NeonAuthOauthProviderId.Github,
      client_id: 'a',
      client_secret: 'b',
    });
  });
});

describe('handleNeonAuthOauthProviderUpdate', () => {
  it('forwards partial config to update', async () => {
    const updateBranchNeonAuthOauthProvider = vi
      .fn()
      .mockResolvedValue({ status: 200 });
    const neonClient = {
      ...defaultBranchMock(),
      updateBranchNeonAuthOauthProvider,
    };
    await handleNeonAuthOauthProviderUpdate(
      {
        projectId: 'p1',
        branchId: 'b1',
        provider_id: 'github',
        oauth_provider_config: { client_secret: 'rotated' },
      },
      neonClient as never,
      extra,
    );
    expect(updateBranchNeonAuthOauthProvider).toHaveBeenCalledWith(
      'p1',
      'b1',
      'github',
      { client_secret: 'rotated' },
    );
  });
});

describe('handleNeonAuthOauthProviderDelete', () => {
  it('accepts 204 from upstream', async () => {
    const deleteBranchNeonAuthOauthProvider = vi
      .fn()
      .mockResolvedValue({ status: 204 });
    const neonClient = {
      ...defaultBranchMock(),
      deleteBranchNeonAuthOauthProvider,
    };
    const result = await handleNeonAuthOauthProviderDelete(
      { projectId: 'p1', provider_id: NeonAuthOauthProviderId.Vercel },
      neonClient as never,
      extra,
    );
    expect(result.isError).toBeFalsy();
    expect(deleteBranchNeonAuthOauthProvider).toHaveBeenCalledWith(
      'p1',
      'br-default',
      NeonAuthOauthProviderId.Vercel,
    );
  });
});

// ---------------------------------------------------------------------------
// Domain update — partial failure, batch fan-out
// ---------------------------------------------------------------------------
describe('handleNeonAuthDomainUpdate', () => {
  it('fans out add as POST per URL and remove as a single batch', async () => {
    const addBranchNeonAuthTrustedDomain = vi
      .fn()
      .mockResolvedValue({ status: 201 });
    const deleteBranchNeonAuthTrustedDomain = vi
      .fn()
      .mockResolvedValue({ status: 200 });
    const updateNeonAuthAllowLocalhost = vi.fn().mockResolvedValue({
      status: 200,
      data: { allow_localhost: true },
    });
    const neonClient = {
      ...defaultBranchMock(),
      addBranchNeonAuthTrustedDomain,
      deleteBranchNeonAuthTrustedDomain,
      updateNeonAuthAllowLocalhost,
    };

    const result = await handleNeonAuthDomainUpdate(
      {
        projectId: 'p1',
        add: ['https://a.com', 'https://b.com'],
        remove: ['https://old.com'],
        allow_localhost: true,
      },
      neonClient as never,
      extra,
    );
    expect(result.isError).toBeFalsy();
    expect(addBranchNeonAuthTrustedDomain).toHaveBeenCalledTimes(2);
    expect(addBranchNeonAuthTrustedDomain).toHaveBeenCalledWith(
      'p1',
      'br-default',
      {
        domain: 'https://a.com',
        auth_provider: NeonAuthSupportedAuthProvider.BetterAuth,
      },
    );
    expect(deleteBranchNeonAuthTrustedDomain).toHaveBeenCalledTimes(1);
    expect(deleteBranchNeonAuthTrustedDomain).toHaveBeenCalledWith(
      'p1',
      'br-default',
      {
        auth_provider: NeonAuthSupportedAuthProvider.BetterAuth,
        domains: [{ domain: 'https://old.com' }],
      },
    );
    expect(updateNeonAuthAllowLocalhost).toHaveBeenCalled();
  });

  it('reports per-URL failure transparently', async () => {
    let call = 0;
    const addBranchNeonAuthTrustedDomain = vi.fn().mockImplementation(() => {
      call += 1;
      if (call === 2) {
        return Promise.resolve({ status: 400, statusText: 'Bad' });
      }
      return Promise.resolve({ status: 201 });
    });
    const neonClient = {
      ...defaultBranchMock(),
      addBranchNeonAuthTrustedDomain,
    };

    const result = await handleNeonAuthDomainUpdate(
      {
        projectId: 'p1',
        add: ['https://a.com', 'https://b.com'],
      },
      neonClient as never,
      extra,
    );
    expect(result.isError).toBe(true);
    const text = getText(result);
    expect(text).toContain('partially failed');
    expect(text).toContain('https://a.com');
    expect(text).toContain('https://b.com');
    expect(text).toContain('"ok": true');
    expect(text).toContain('"ok": false');
  });
});

// ---------------------------------------------------------------------------
// Webhook update
// ---------------------------------------------------------------------------
describe('handleNeonAuthWebhookUpdate', () => {
  it('forwards optional fields verbatim', async () => {
    const updateNeonAuthWebhookConfig = vi
      .fn()
      .mockResolvedValue({ status: 200, data: {} });
    const neonClient = {
      ...defaultBranchMock(),
      updateNeonAuthWebhookConfig,
    };
    await handleNeonAuthWebhookUpdate(
      {
        projectId: 'p1',
        enabled: true,
        url: 'https://hooks/',
        events: ['user.created'],
        timeout_seconds: 5,
      },
      neonClient as never,
      extra,
    );
    expect(updateNeonAuthWebhookConfig).toHaveBeenCalledWith(
      'p1',
      'br-default',
      {
        enabled: true,
        webhook_url: 'https://hooks/',
        enabled_events: ['user.created'],
        timeout_seconds: 5,
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Send test email
// ---------------------------------------------------------------------------
describe('handleNeonAuthSendTestEmail', () => {
  it('passes through full SMTP payload to sendNeonAuthTestEmail', async () => {
    const sendNeonAuthTestEmail = vi.fn().mockResolvedValue({
      status: 200,
      data: { success: true },
    });
    const neonClient = { ...defaultBranchMock(), sendNeonAuthTestEmail };
    const result = await handleNeonAuthSendTestEmail(
      {
        projectId: 'p1',
        recipient_email: 'me@example.com',
        host: 'smtp.example.com',
        port: 587,
        username: 'u',
        password: 'p',
        sender_email: 'a@b.co',
        sender_name: 'Acme',
      },
      neonClient as never,
      extra,
    );
    expect(result.isError).toBeFalsy();
    expect(sendNeonAuthTestEmail).toHaveBeenCalledWith('p1', 'br-default', {
      recipient_email: 'me@example.com',
      host: 'smtp.example.com',
      port: 587,
      username: 'u',
      password: 'p',
      sender_email: 'a@b.co',
      sender_name: 'Acme',
    });
  });

  it('surfaces upstream success=false as isError', async () => {
    const neonClient = {
      ...defaultBranchMock(),
      sendNeonAuthTestEmail: vi.fn().mockResolvedValue({
        status: 200,
        data: { success: false, error_message: 'auth failed' },
      }),
    };
    const result = await handleNeonAuthSendTestEmail(
      {
        projectId: 'p1',
        recipient_email: 'me@example.com',
        host: 'smtp.example.com',
        port: 587,
        username: 'u',
        password: 'p',
        sender_email: 'a@b.co',
        sender_name: 'Acme',
      },
      neonClient as never,
      extra,
    );
    expect(result.isError).toBe(true);
    const text = getText(result);
    expect(text).toContain('auth failed');
  });
});

// ---------------------------------------------------------------------------
// ensureNeonAuthProvisioned preflight — every non-provision handler short-
// circuits when getNeonAuth returns 404 (or surfaces a generic verify-failed
// error on a 5xx outage), without invoking the per-op SDK mutation.
// ---------------------------------------------------------------------------
describe('Neon Auth preflight (not-provisioned + verify-failed)', () => {
  it('neon_auth_methods_update — 404 returns canonical not-provisioned message and does NOT call any per-slice SDK', async () => {
    const updateNeonAuthEmailAndPasswordConfig = vi.fn();
    const neonClient = {
      ...defaultBranchMock(),
      getNeonAuth: vi.fn().mockResolvedValue({ status: 404 }),
      updateNeonAuthEmailAndPasswordConfig,
    };
    const result = await handleNeonAuthMethodsUpdate(
      {
        projectId: 'p1',
        branchId: 'b1',
        sign_in_methods: { email_password: { enabled: true } },
      },
      neonClient as never,
      extra,
    );
    expect(result.isError).toBe(true);
    expect(updateNeonAuthEmailAndPasswordConfig).not.toHaveBeenCalled();
    const text = getText(result);
    expect(text).toContain('not provisioned');
    expect(text).toContain('explicit approval');
    expect(text).toContain('side effects');
    expect(text).toContain('neon_auth_provision');
  });

  it('neon_auth_oauth_provider_add — 404 returns canonical message and does NOT call addBranchNeonAuthOauthProvider', async () => {
    const addBranchNeonAuthOauthProvider = vi.fn();
    const neonClient = {
      ...defaultBranchMock(),
      getNeonAuth: vi.fn().mockResolvedValue({ status: 404 }),
      addBranchNeonAuthOauthProvider,
    };
    const result = await handleNeonAuthOauthProviderAdd(
      { projectId: 'p1', branchId: 'b1', provider_id: 'google' },
      neonClient as never,
      extra,
    );
    expect(result.isError).toBe(true);
    expect(addBranchNeonAuthOauthProvider).not.toHaveBeenCalled();
    const text = getText(result);
    expect(text).toContain('not provisioned');
  });

  it('neon_auth_domain_update — 404 returns canonical message and does NOT call addBranchNeonAuthTrustedDomain', async () => {
    const addBranchNeonAuthTrustedDomain = vi.fn();
    const neonClient = {
      ...defaultBranchMock(),
      getNeonAuth: vi.fn().mockResolvedValue({ status: 404 }),
      addBranchNeonAuthTrustedDomain,
    };
    const result = await handleNeonAuthDomainUpdate(
      {
        projectId: 'p1',
        branchId: 'b1',
        add: ['https://app.example.com'],
      },
      neonClient as never,
      extra,
    );
    expect(result.isError).toBe(true);
    expect(addBranchNeonAuthTrustedDomain).not.toHaveBeenCalled();
    const text = getText(result);
    expect(text).toContain('not provisioned');
  });

  it('neon_auth_webhook_update — 5xx returns generic verify-failed (NOT the not-provisioned message)', async () => {
    const updateNeonAuthWebhookConfig = vi.fn();
    const neonClient = {
      ...defaultBranchMock(),
      getNeonAuth: vi.fn().mockResolvedValue({
        status: 502,
        statusText: 'Bad Gateway',
      }),
      updateNeonAuthWebhookConfig,
    };
    const result = await handleNeonAuthWebhookUpdate(
      {
        projectId: 'p1',
        branchId: 'b1',
        enabled: true,
        url: 'https://hooks.example.com/neon',
        events: ['user.created'],
      },
      neonClient as never,
      extra,
    );
    expect(result.isError).toBe(true);
    expect(updateNeonAuthWebhookConfig).not.toHaveBeenCalled();
    const text = getText(result);
    // 5xx must NOT be misrepresented as "not provisioned"
    expect(text).not.toContain('not provisioned');
    expect(text).not.toContain('explicit approval');
    expect(text).toContain('Failed to verify');
    expect(text).toContain('502');
  });
});
