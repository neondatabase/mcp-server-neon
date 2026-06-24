import { vi } from 'vitest';
import {
  NeonAuthEmailVerificationMethod,
  NeonAuthProviderProjectOwnedBy,
  NeonAuthSupportedAuthProvider,
} from '@neondatabase/api-client';

/**
 * Shared default mocks for the API endpoints that
 * `fetchNeonAuthConfigurableSettings` calls under the hood, plus the
 * `getNeonAuth` integration probe used by `ensureNeonAuthProvisioned` (the
 * prerequisite check at the top of `handleConfigureNeonAuth`). Spread this
 * into a test's `neonClient` mock to satisfy snapshot reloads + the prereq
 * probe when the test only cares about a specific operation.
 *
 * Override individual methods at the call site when a test needs to assert
 * a specific snapshot shape or exercise a non-default integration state
 * (e.g. `getNeonAuth: 404` for the "not provisioned" branch).
 */
export const EMAIL_PASSWORD_DEFAULTS = {
  enabled: true,
  email_verification_method: NeonAuthEmailVerificationMethod.Link,
  require_email_verification: false,
  auto_sign_in_after_verification: true,
  send_verification_email_on_sign_up: false,
  send_verification_email_on_sign_in: false,
  disable_sign_up: false,
};

export function defaultSnapshotMocks() {
  return {
    // Default: Neon Auth IS provisioned. Override with `status: 404` to
    // exercise the prereq short-circuit in `handleConfigureNeonAuth` and
    // `handleGetNeonAuthConfig`.
    getNeonAuth: vi.fn().mockResolvedValue({
      status: 200,
      data: {
        auth_provider: NeonAuthSupportedAuthProvider.BetterAuth,
        auth_provider_project_id: 'ap-default',
        branch_id: 'br-default',
        db_name: 'neondb',
        created_at: '2025-01-01T00:00:00.000Z',
        owned_by: NeonAuthProviderProjectOwnedBy.Neon,
        jwks_url: 'https://jwks.example/',
        base_url: 'https://auth.example/',
      },
    }),
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
    listBranchNeonAuthOauthProviders: vi.fn().mockResolvedValue({
      status: 200,
      data: { providers: [] },
    }),
    // Default: shared (Neon-managed) email provider with no sender
    // overrides. Tests that need the "no provider configured" path
    // (axios 404) should override this mock with `mockRejectedValue` of a
    // synthetic AxiosError.
    getNeonAuthEmailProvider: vi.fn().mockResolvedValue({
      status: 200,
      data: { type: 'shared' },
    }),
  };
}
