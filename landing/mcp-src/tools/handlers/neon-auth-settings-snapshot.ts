import {
  Api,
  NeonAuthEmailAndPasswordConfig,
  NeonAuthEmailServerConfig,
  NeonAuthEmailVerificationMethod,
  NeonAuthOauthProvider,
  NeonAuthOauthProviderId,
  NeonAuthOauthProviderType,
} from '@neondatabase/api-client';
import { isAxiosError } from 'axios';

/**
 * Sentinel value used in `get_neon_auth_config` and configure success
 * snapshots to indicate that a secret (OAuth `client_secret`, SMTP
 * `password`) is set on the server but redacted in transit. The presence of
 * this string ALWAYS means "secret is set"; `null` ALWAYS means "secret is
 * not set". Never echo upstream's actual secret value.
 */
export const REDACTED_SECRET = '***redacted***' as const;

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

/**
 * OAuth provider snapshot. Mirrors the upstream `NeonAuthOauthProvider`
 * shape with one critical difference: `client_secret` is never echoed back.
 * If the upstream response indicates a secret is set, we surface it as the
 * `REDACTED_SECRET` sentinel so callers can still distinguish "credentials
 * configured" from "no credentials" without ever seeing the value.
 */
type OAuthProviderSnapshot = {
  id: NeonAuthOauthProviderId;
  // 'standard' = BYO credentials, 'shared' = Neon-managed credentials.
  type: NeonAuthOauthProviderType;
  client_id: string | null;
  client_secret: typeof REDACTED_SECRET | null;
};

/**
 * Email provider snapshot, discriminated by `type` to mirror the upstream
 * `NeonAuthEmailServerConfig` union. As with OAuth, the SMTP `password` is
 * redacted to `REDACTED_SECRET` whenever the upstream indicates one is set.
 */
type EmailProviderSnapshot =
  | {
      type: 'standard';
      host: string;
      port: number;
      username: string;
      password: typeof REDACTED_SECRET | null;
      sender_email: string;
      sender_name: string;
    }
  | {
      type: 'shared';
      sender_email: string | null;
      sender_name: string | null;
    };

type NeonAuthConfigurableSettings = {
  trusted_origins: string[];
  allow_localhost: boolean | null;
  auth_methods: {
    email_password: EmailPasswordAuthMethodSnapshot | null;
  };
  oauth_providers: OAuthProviderSnapshot[];
  email_provider: EmailProviderSnapshot | null;
};

type NeonAuthConfigurableSettingsErrors = Partial<{
  trusted_origins: string;
  allow_localhost: string;
  email_password: string;
  oauth_providers: string;
  email_provider: string;
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

function oauthProviderSnapshot(
  p: NeonAuthOauthProvider,
): OAuthProviderSnapshot {
  return {
    id: p.id,
    type: p.type,
    client_id: p.client_id ?? null,
    // Any non-empty client_secret returned by upstream becomes the sentinel.
    // Never echo the actual value back to the caller.
    client_secret: p.client_secret ? REDACTED_SECRET : null,
  };
}

function emailProviderSnapshot(
  data: NeonAuthEmailServerConfig,
): EmailProviderSnapshot {
  if (data.type === 'standard') {
    return {
      type: 'standard',
      host: data.host,
      port: data.port,
      username: data.username,
      password: data.password ? REDACTED_SECRET : null,
      sender_email: data.sender_email,
      sender_name: data.sender_name,
    };
  }
  return {
    type: 'shared',
    sender_email: data.sender_email ?? null,
    sender_name: data.sender_name ?? null,
  };
}

function buildNeonAuthConfigurableSettingsFromSlices(
  domainsRes: Slice<{ domains: { domain: string }[] }>,
  localhostRes: Slice<{ allow_localhost: boolean }>,
  emailRes: Slice<NeonAuthEmailAndPasswordConfig>,
  oauthRes: Slice<{ providers: NeonAuthOauthProvider[] }>,
  emailProviderRes: Slice<NeonAuthEmailServerConfig>,
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

  let oauth_providers: OAuthProviderSnapshot[] = [];
  if (oauthRes.status === 200 && oauthRes.data) {
    oauth_providers = oauthRes.data.providers.map(oauthProviderSnapshot);
  } else {
    errors.oauth_providers = `${oauthRes.status} ${oauthRes.statusText}`;
  }

  let email_provider: EmailProviderSnapshot | null = null;
  if (emailProviderRes.status === 200 && emailProviderRes.data) {
    email_provider = emailProviderSnapshot(emailProviderRes.data);
  } else if (emailProviderRes.status === 404) {
    // Email provider not configured yet — treat as null rather than error.
    email_provider = null;
  } else {
    errors.email_provider = `${emailProviderRes.status} ${emailProviderRes.statusText}`;
  }

  return {
    settings: {
      trusted_origins,
      allow_localhost,
      auth_methods: { email_password },
      oauth_providers,
      email_provider,
    },
    errors,
  };
}

// Email provider may not be configured on a fresh branch; the upstream API
// returns 404 in that case, which axios surfaces as a thrown AxiosError.
// We translate that into the same Slice<T> shape the other endpoints use so
// the caller sees a uniform "missing data" signal instead of a thrown
// rejection.
async function safeFetchEmailProvider(
  neonClient: Api<unknown>,
  projectId: string,
  branchId: string,
): Promise<Slice<NeonAuthEmailServerConfig>> {
  try {
    return await neonClient.getNeonAuthEmailProvider(projectId, branchId);
  } catch (err) {
    if (isAxiosError(err) && err.response) {
      return {
        status: err.response.status,
        statusText: err.response.statusText,
      };
    }
    throw err;
  }
}

export async function fetchNeonAuthConfigurableSettings(
  neonClient: Api<unknown>,
  projectId: string,
  branchId: string,
): Promise<{
  settings: NeonAuthConfigurableSettings;
  errors: NeonAuthConfigurableSettingsErrors;
}> {
  const [domainsRes, localhostRes, emailRes, oauthRes, emailProviderRes] =
    await Promise.all([
      neonClient.listBranchNeonAuthTrustedDomains(projectId, branchId),
      neonClient.getNeonAuthAllowLocalhost(projectId, branchId),
      neonClient.getNeonAuthEmailAndPasswordConfig(projectId, branchId),
      neonClient.listBranchNeonAuthOauthProviders(projectId, branchId),
      safeFetchEmailProvider(neonClient, projectId, branchId),
    ]);
  return buildNeonAuthConfigurableSettingsFromSlices(
    domainsRes,
    localhostRes,
    emailRes,
    oauthRes,
    emailProviderRes,
  );
}

/**
 * Slice-only fetch + stringify for OAuth providers. Used by the
 * configure_neon_auth `*_oauth_provider` operations to keep their success
 * responses focused — per product preference we don't dump the full
 * settings snapshot when the change only affects this slice.
 */
export async function fetchOAuthProvidersSlice(
  neonClient: Api<unknown>,
  projectId: string,
  branchId: string,
): Promise<{ providers: OAuthProviderSnapshot[]; error?: string }> {
  const res = await neonClient.listBranchNeonAuthOauthProviders(
    projectId,
    branchId,
  );
  if (res.status === 200 && res.data) {
    return { providers: res.data.providers.map(oauthProviderSnapshot) };
  }
  return { providers: [], error: `${res.status} ${res.statusText}` };
}

/**
 * Slice-only fetch + stringify for the email provider config. Same
 * rationale as `fetchOAuthProvidersSlice`: focused responses for focused
 * operations.
 */
export async function fetchEmailProviderSlice(
  neonClient: Api<unknown>,
  projectId: string,
  branchId: string,
): Promise<{ provider: EmailProviderSnapshot | null; error?: string }> {
  const res = await safeFetchEmailProvider(neonClient, projectId, branchId);
  if (res.status === 200 && res.data) {
    return { provider: emailProviderSnapshot(res.data) };
  }
  if (res.status === 404) {
    return { provider: null };
  }
  return {
    provider: null,
    error: `${res.status} ${res.statusText}`,
  };
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

export function stringifyOAuthProvidersSlice(
  title: string,
  providers: OAuthProviderSnapshot[],
  error?: string,
): string {
  const body: Record<string, unknown> = { oauth_providers: providers };
  if (error) {
    body._errors = { oauth_providers: error };
  }
  return `${title}\n\`\`\`json\n${JSON.stringify(body, null, 2)}\n\`\`\``;
}

export function stringifyEmailProviderSlice(
  title: string,
  provider: EmailProviderSnapshot | null,
  error?: string,
): string {
  const body: Record<string, unknown> = { email_provider: provider };
  if (error) {
    body._errors = { email_provider: error };
  }
  return `${title}\n\`\`\`json\n${JSON.stringify(body, null, 2)}\n\`\`\``;
}
