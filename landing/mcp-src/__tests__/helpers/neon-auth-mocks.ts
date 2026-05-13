import { vi } from 'vitest';
import { NeonAuthEmailVerificationMethod } from '@neondatabase/api-client';

/**
 * Shared default mocks for the API endpoints that
 * `fetchNeonAuthConfigurableSettings` calls under the hood. Spread this into
 * a test's `neonClient` mock to satisfy snapshot reloads when the test only
 * cares about a specific operation but the success path renders a snapshot.
 *
 * Override individual methods at the call site when a test needs to assert
 * a specific snapshot shape.
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
