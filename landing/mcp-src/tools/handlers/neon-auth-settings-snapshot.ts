import {
  Api,
  NeonAuthEmailAndPasswordConfig,
  NeonAuthEmailVerificationMethod,
} from '@neondatabase/api-client';

/**
 * Canonical Neon Auth settings shape shared by get_neon_auth_config and
 * configure_neon_auth success responses (same keys configure reads/writes).
 *
 * `trusted_origins` reflects the Better Auth `trustedOrigins` list. Better
 * Auth uses it to (a) validate the request Origin/Referer header for CSRF on
 * state-changing endpoints and (b) authorize URLs passed via callbackURL,
 * redirectTo, errorCallbackURL, and newUserCallbackURL across sign-in,
 * OAuth provider, email verification, password reset, and magic-link flows.
 * Entries may be plain origins/URLs (https://app.example.com), wildcard
 * patterns (https://*.example.com, https://**.example.com, exp://.../**),
 * or custom schemes (myapp://). The Neon API still names the underlying
 * endpoint "trusted domain" / "redirect URI whitelist", but the runtime
 * semantics are broader.
 *
 * The `auth_methods.email_password` block mirrors the input shape accepted by
 * `configure_neon_auth update_auth_methods` so that read and write stay in
 * lockstep. Friendly names map to the Neon Auth API as follows:
 *   - allow_sign_up                   ↔ !disable_sign_up
 *   - verify_email_on_sign_up         ↔ send_verification_email_on_sign_up
 *   - verify_email_on_sign_in         ↔ send_verification_email_on_sign_in
 *   - email_verification_method       ↔ email_verification_method (link|otp)
 *   - require_email_verification      ↔ require_email_verification
 *   - auto_sign_in_after_verification ↔ auto_sign_in_after_verification
 */
type EmailPasswordAuthMethodSnapshot = {
  enabled: boolean;
  allow_sign_up: boolean;
  verify_email_on_sign_up: boolean;
  verify_email_on_sign_in: boolean;
  // Sourced directly from the SDK so a new upstream verification method
  // (passkey, etc.) widens this type at compile time and surfaces in a TS
  // diff rather than silently coercing through a local literal union.
  email_verification_method: NeonAuthEmailVerificationMethod;
  require_email_verification: boolean;
  auto_sign_in_after_verification: boolean;
};

type NeonAuthConfigurableSettings = {
  trusted_origins: string[];
  allow_localhost: boolean | null;
  auth_methods: {
    email_password: EmailPasswordAuthMethodSnapshot | null;
  };
};

type NeonAuthConfigurableSettingsErrors = Partial<{
  trusted_origins: string;
  allow_localhost: string;
  email_password: string;
}>;

type Slice<T> = { status: number; statusText: string; data?: T };

function emailPasswordSnapshot(
  data: NeonAuthEmailAndPasswordConfig,
): EmailPasswordAuthMethodSnapshot {
  return {
    enabled: data.enabled,
    allow_sign_up: !data.disable_sign_up,
    verify_email_on_sign_up: data.send_verification_email_on_sign_up,
    verify_email_on_sign_in: data.send_verification_email_on_sign_in,
    email_verification_method: data.email_verification_method,
    require_email_verification: data.require_email_verification,
    auto_sign_in_after_verification: data.auto_sign_in_after_verification,
  };
}

function buildNeonAuthConfigurableSettingsFromSlices(
  domainsRes: Slice<{ domains: { domain: string }[] }>,
  localhostRes: Slice<{ allow_localhost: boolean }>,
  emailRes: Slice<NeonAuthEmailAndPasswordConfig>,
): {
  settings: NeonAuthConfigurableSettings;
  errors: NeonAuthConfigurableSettingsErrors;
} {
  const errors: NeonAuthConfigurableSettingsErrors = {};

  let trusted_origins: string[] = [];
  if (domainsRes.status === 200 && domainsRes.data) {
    trusted_origins = domainsRes.data.domains.map((d) => d.domain);
  } else {
    errors.trusted_origins = `${domainsRes.status} ${domainsRes.statusText}`;
  }

  let allow_localhost: boolean | null = null;
  if (localhostRes.status === 200 && localhostRes.data) {
    allow_localhost = localhostRes.data.allow_localhost;
  } else {
    errors.allow_localhost = `${localhostRes.status} ${localhostRes.statusText}`;
  }

  let email_password: EmailPasswordAuthMethodSnapshot | null = null;
  if (emailRes.status === 200 && emailRes.data) {
    email_password = emailPasswordSnapshot(emailRes.data);
  } else {
    errors.email_password = `${emailRes.status} ${emailRes.statusText}`;
  }

  return {
    settings: {
      trusted_origins,
      allow_localhost,
      auth_methods: { email_password },
    },
    errors,
  };
}

export async function fetchNeonAuthConfigurableSettings(
  neonClient: Api<unknown>,
  projectId: string,
  branchId: string,
): Promise<{
  settings: NeonAuthConfigurableSettings;
  errors: NeonAuthConfigurableSettingsErrors;
}> {
  const [domainsRes, localhostRes, emailRes] = await Promise.all([
    neonClient.listBranchNeonAuthTrustedDomains(projectId, branchId),
    neonClient.getNeonAuthAllowLocalhost(projectId, branchId),
    neonClient.getNeonAuthEmailAndPasswordConfig(projectId, branchId),
  ]);
  return buildNeonAuthConfigurableSettingsFromSlices(
    domainsRes,
    localhostRes,
    emailRes,
  );
}

export function stringifyNeonAuthConfigurableSettings(
  title: string,
  settings: NeonAuthConfigurableSettings,
  errors: NeonAuthConfigurableSettingsErrors,
): string {
  const body: Record<string, unknown> = { ...settings };
  if (Object.keys(errors).length > 0) {
    body._errors = errors;
  }
  return `${title}\n\`\`\`json\n${JSON.stringify(body, null, 2)}\n\`\`\``;
}
