import { describe, it, expect, vi } from 'vitest';
import {
  NeonAuthEmailVerificationMethod,
  NeonAuthProviderProjectOwnedBy,
  NeonAuthSupportedAuthProvider,
} from '@neondatabase/api-client';
import { handleGetNeonAuthConfig } from '../tools/handlers/neon-auth-get-config';
import { REDACTED_SECRET } from '../tools/handlers/neon-auth-settings-snapshot';
import type { ToolHandlerExtraParams } from '../tools/types';
import { defaultSnapshotMocks } from './helpers/neon-auth-mocks';

const extra = {} as ToolHandlerExtraParams;

function parseSettingsJson(text: string): Record<string, unknown> {
  const start = text.indexOf('```json');
  const end = text.lastIndexOf('```');
  const raw = text.slice(start + '```json'.length, end).trim();
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('handleGetNeonAuthConfig', () => {
  it('returns integration, branch name, and configurable settings in one JSON object', async () => {
    const neonClient = {
      ...defaultSnapshotMocks(),
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
      getProjectBranch: vi.fn().mockResolvedValue({
        status: 200,
        data: {
          branch: {
            id: 'br-1',
            name: 'main',
            project_id: 'p1',
            parent_id: 'br-root',
            default: true,
            protected: false,
            created_at: '',
            updated_at: '',
            compute_time_seconds: 0,
            written_data_bytes: 0,
            data_transfer_bytes: 0,
          },
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
      expect(body.project_id).toBe('p1');
      expect(body.branch_id).toBe('br-1');
      expect(body.branch_name).toBe('main');
      expect(body.base_url).toBe('https://auth.example/');
      expect(body.jwks_url).toBe('https://jwks.example/');
      expect(body.db_name).toBe('neondb');
      expect(body.integration).toMatchObject({
        auth_provider: NeonAuthSupportedAuthProvider.BetterAuth,
        auth_provider_project_id: 'ap1',
        branch_id: 'br-1',
        db_name: 'neondb',
        created_at: '2025-01-01T00:00:00.000Z',
        owned_by: NeonAuthProviderProjectOwnedBy.Neon,
        jwks_url: 'https://jwks.example/',
        base_url: 'https://auth.example/',
      });
      expect(body.trusted_origins).toEqual([
        'https://app.example.com/callback',
      ]);
      expect(body.allow_localhost).toBe(true);
      expect(body.auth_methods).toEqual({
        email_password: {
          enabled: true,
          allow_sign_up: true,
          verify_email_on_sign_up: true,
          verify_email_on_sign_in: false,
          email_verification_method: NeonAuthEmailVerificationMethod.Link,
          require_email_verification: false,
          auto_sign_in_after_verification: true,
        },
      });
      // PR2 additions: oauth_providers + email_provider slices show up in
      // every snapshot, even when the only configured provider is the
      // Neon-managed shared SMTP.
      expect(body.oauth_providers).toEqual([]);
      expect(body.email_provider).toEqual({
        type: 'shared',
        sender_email: null,
        sender_name: null,
      });
      expect(body._errors).toBeUndefined();
    }
  });

  it('redacts OAuth client_secret and SMTP password in the returned snapshot', async () => {
    const neonClient = {
      ...defaultSnapshotMocks(),
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
      getProjectBranch: vi.fn().mockResolvedValue({
        status: 200,
        data: {
          branch: {
            id: 'br-1',
            name: 'main',
            project_id: 'p1',
            parent_id: 'br-root',
            default: true,
            protected: false,
            created_at: '',
            updated_at: '',
            compute_time_seconds: 0,
            written_data_bytes: 0,
            data_transfer_bytes: 0,
          },
        },
      }),
      // Provider with credentials set: client_secret comes back from upstream
      // as a non-empty value. The snapshot MUST replace it with the sentinel.
      listBranchNeonAuthOauthProviders: vi.fn().mockResolvedValue({
        status: 200,
        data: {
          providers: [
            {
              id: 'github',
              type: 'standard',
              client_id: 'gh-app-id',
              client_secret: 'super-secret-from-upstream',
            },
            {
              id: 'google',
              type: 'shared',
              // Shared mode: no credentials in upstream payload at all.
            },
          ],
        },
      }),
      // Standard SMTP with a password set upstream — must be redacted.
      getNeonAuthEmailProvider: vi.fn().mockResolvedValue({
        status: 200,
        data: {
          type: 'standard',
          host: 'smtp.sendgrid.net',
          port: 587,
          username: 'apikey',
          password: 'super-secret-smtp-from-upstream',
          sender_email: 'noreply@example.com',
          sender_name: 'Acme',
        },
      }),
    };

    const result = await handleGetNeonAuthConfig(
      { projectId: 'p1' },
      neonClient as never,
      extra,
    );

    expect(result.isError).toBeFalsy();
    if (result.content[0].type === 'text') {
      const rawText = result.content[0].text;
      // Hard contract: upstream secret values must NEVER appear anywhere in
      // the rendered output.
      expect(rawText).not.toContain('super-secret-from-upstream');
      expect(rawText).not.toContain('super-secret-smtp-from-upstream');

      const body = parseSettingsJson(rawText);
      expect(body.oauth_providers).toEqual([
        {
          id: 'github',
          type: 'standard',
          client_id: 'gh-app-id',
          client_secret: REDACTED_SECRET,
        },
        {
          id: 'google',
          type: 'shared',
          client_id: null,
          client_secret: null,
        },
      ]);
      expect(body.email_provider).toEqual({
        type: 'standard',
        host: 'smtp.sendgrid.net',
        port: 587,
        username: 'apikey',
        password: REDACTED_SECRET,
        sender_email: 'noreply@example.com',
        sender_name: 'Acme',
      });
    }
  });

  it('attaches a sanitized upstream error snippet when the email_provider fetch fails with non-404', async () => {
    // Long body (>200 chars) with a `message` field plus a control character
    // to confirm we (a) prefer `message` over the rest, (b) strip control
    // characters, and (c) truncate the snippet so a chatty upstream cannot
    // dominate the rendered tool output.
    const longMessage = 'upstream rejected: ' + 'x'.repeat(500);
    const axiosError500 = Object.assign(
      new Error('Request failed with status code 500'),
      {
        isAxiosError: true,
        response: {
          status: 500,
          statusText: 'Internal Server Error',
          data: {
            message: `${longMessage}\u0001\u0007  `,
            unrelated_field: 'should be ignored',
          },
        },
      },
    );
    const neonClient = {
      ...defaultSnapshotMocks(),
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
      getProjectBranch: vi.fn().mockResolvedValue({
        status: 200,
        data: {
          branch: {
            id: 'br-1',
            name: 'main',
            project_id: 'p1',
            parent_id: 'br-root',
            default: true,
            protected: false,
            created_at: '',
            updated_at: '',
            compute_time_seconds: 0,
            written_data_bytes: 0,
            data_transfer_bytes: 0,
          },
        },
      }),
      getNeonAuthEmailProvider: vi.fn().mockRejectedValue(axiosError500),
    };

    const result = await handleGetNeonAuthConfig(
      { projectId: 'p1' },
      neonClient as never,
      extra,
    );

    expect(result.isError).toBeFalsy();
    if (result.content[0].type === 'text') {
      const body = parseSettingsJson(result.content[0].text);
      expect(body.email_provider).toBeNull();
      // _errors must be present (this is a real fetch failure, unlike 404)
      // and must include a sanitized snippet of the upstream message.
      const errors = body._errors as Record<string, string> | undefined;
      expect(errors).toBeDefined();
      expect(errors!.email_provider).toContain('500');
      expect(errors!.email_provider).toContain('upstream rejected');
      // Truncated to <= ~200 chars + ellipsis — the full 500-char tail
      // must not appear verbatim.
      expect(errors!.email_provider).toContain('…');
      expect(errors!.email_provider.length).toBeLessThan(280);
      // Control characters must be stripped.
      expect(errors!.email_provider).not.toMatch(/[\u0000-\u001F\u007F]/);
      // Untouched upstream fields other than message/error/detail are not
      // surfaced.
      expect(errors!.email_provider).not.toContain('unrelated_field');
      expect(errors!.email_provider).not.toContain('should be ignored');
    }
  });

  it('reports email_provider as null when upstream returns 404 (no provider configured)', async () => {
    const axiosError404 = Object.assign(
      new Error('Request failed with status code 404'),
      {
        isAxiosError: true,
        response: { status: 404, statusText: 'Not Found' },
      },
    );
    const neonClient = {
      ...defaultSnapshotMocks(),
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
      getProjectBranch: vi.fn().mockResolvedValue({
        status: 200,
        data: {
          branch: {
            id: 'br-1',
            name: 'main',
            project_id: 'p1',
            parent_id: 'br-root',
            default: true,
            protected: false,
            created_at: '',
            updated_at: '',
            compute_time_seconds: 0,
            written_data_bytes: 0,
            data_transfer_bytes: 0,
          },
        },
      }),
      getNeonAuthEmailProvider: vi.fn().mockRejectedValue(axiosError404),
    };

    const result = await handleGetNeonAuthConfig(
      { projectId: 'p1' },
      neonClient as never,
      extra,
    );

    expect(result.isError).toBeFalsy();
    if (result.content[0].type === 'text') {
      const body = parseSettingsJson(result.content[0].text);
      expect(body.email_provider).toBeNull();
      // 404 is "not configured", not an error — should NOT contribute to
      // the partial-failures _errors block.
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
