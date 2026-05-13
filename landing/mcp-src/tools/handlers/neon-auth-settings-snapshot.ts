import {
  Api,
  NeonAuthEmailAndPasswordConfig,
  NeonAuthEmailVerificationMethod,
  NeonAuthMagicLinkConfig,
  NeonAuthOrganizationConfig,
  NeonAuthPhoneNumberConfig,
  NeonAuthPluginConfigs,
  NeonAuthWebhookConfig,
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
 *
 * The `auth_methods.email_password` block mirrors the input shape accepted by
 * `configure_neon_auth update_auth_methods` so that read and write stay in
 * lockstep.
 *
 * `plugins.*` mirror the inputs accepted by `configure_neon_auth update_plugin`
 * (friendly field names, e.g. `allow_sign_up` → !disable_sign_up,
 * `expires_in_minutes` → expires_in).
 *
 * `webhook` deliberately NEVER includes `webhook_url`. The URL is a sensitive
 * outbound destination — leaking it back through MCP would let any client see
 * where auth events are delivered and enable replay attacks on the receiver.
 * We emit `webhook_url_set: boolean` so the caller can tell whether one is
 * configured. The same redaction rule applies to any future SMTP creds /
 * webhook-signing secrets — add a `*_set: boolean` companion instead of
 * leaking the secret itself.
 */
type EmailPasswordAuthMethodSnapshot = {
  enabled: boolean;
  allow_sign_up: boolean;
  verify_email_on_sign_up: boolean;
  verify_email_on_sign_in: boolean;
  email_verification_method: NeonAuthEmailVerificationMethod;
  require_email_verification: boolean;
  auto_sign_in_after_verification: boolean;
};

type MagicLinkPluginSnapshot = {
  enabled: boolean;
  allow_sign_up: boolean;
  expires_in_minutes: number;
};

type PhoneNumberPluginSnapshot = {
  enabled: boolean;
  otp_expires_in_seconds: number | null;
};

type OrganizationPluginSnapshot = {
  enabled: boolean;
  organization_limit: number;
  membership_limit: number;
  creator_role: 'admin' | 'owner';
  send_invitation_email: boolean;
};

type WebhookSnapshot = {
  enabled: boolean;
  webhook_url_set: boolean;
  enabled_events: string[];
  timeout_seconds: number | null;
};

export type NeonAuthConfigurableSettings = {
  trusted_origins: string[];
  allow_localhost: boolean | null;
  auth_methods: {
    email_password: EmailPasswordAuthMethodSnapshot | null;
  };
  plugins: {
    magic_link: MagicLinkPluginSnapshot | null;
    phone_number: PhoneNumberPluginSnapshot | null;
    organization: OrganizationPluginSnapshot | null;
  };
  webhook: WebhookSnapshot | null;
  email_server_ready: boolean | null;
};

export type NeonAuthConfigurableSettingsErrors = Partial<{
  trusted_origins: string;
  allow_localhost: string;
  email_password: string;
  plugins: string;
  webhook: string;
  email_server: string;
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

function magicLinkSnapshot(
  data: NeonAuthMagicLinkConfig,
): MagicLinkPluginSnapshot {
  return {
    enabled: data.enabled,
    allow_sign_up: !data.disable_sign_up,
    expires_in_minutes: data.expires_in,
  };
}

function phoneNumberSnapshot(
  data: NeonAuthPhoneNumberConfig,
): PhoneNumberPluginSnapshot {
  return {
    enabled: data.enabled,
    otp_expires_in_seconds: data.otp_expires_in ?? null,
  };
}

function organizationSnapshot(
  data: NeonAuthOrganizationConfig,
): OrganizationPluginSnapshot {
  return {
    enabled: data.enabled,
    organization_limit: data.organization_limit,
    membership_limit: data.membership_limit,
    creator_role: data.creator_role,
    send_invitation_email: data.send_invitation_email,
  };
}

function webhookSnapshot(data: NeonAuthWebhookConfig): WebhookSnapshot {
  return {
    enabled: data.enabled,
    // Intentional redaction: never echo the URL back. See header docblock.
    webhook_url_set:
      typeof data.webhook_url === 'string' && data.webhook_url.length > 0,
    enabled_events: data.enabled_events ?? [],
    timeout_seconds: data.timeout_seconds ?? null,
  };
}

function buildNeonAuthConfigurableSettingsFromSlices(
  domainsRes: Slice<{ domains: { domain: string }[] }>,
  localhostRes: Slice<{ allow_localhost: boolean }>,
  emailRes: Slice<NeonAuthEmailAndPasswordConfig>,
  pluginsRes: Slice<NeonAuthPluginConfigs>,
  webhookRes: Slice<NeonAuthWebhookConfig>,
  emailServerRes: Slice<unknown> | null,
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

  let magic_link: MagicLinkPluginSnapshot | null = null;
  let phone_number: PhoneNumberPluginSnapshot | null = null;
  let organization: OrganizationPluginSnapshot | null = null;
  if (pluginsRes.status === 200 && pluginsRes.data) {
    if (pluginsRes.data.magic_link) {
      magic_link = magicLinkSnapshot(pluginsRes.data.magic_link);
    }
    if (pluginsRes.data.phone_number) {
      phone_number = phoneNumberSnapshot(pluginsRes.data.phone_number);
    }
    if (pluginsRes.data.organization) {
      organization = organizationSnapshot(pluginsRes.data.organization);
    }
  } else {
    errors.plugins = `${pluginsRes.status} ${pluginsRes.statusText}`;
  }

  let webhook: WebhookSnapshot | null = null;
  if (webhookRes.status === 200 && webhookRes.data) {
    webhook = webhookSnapshot(webhookRes.data);
  } else if (webhookRes.status === 404) {
    // 404 is a valid "no webhook configured yet" — leave null without error.
    webhook = null;
  } else {
    errors.webhook = `${webhookRes.status} ${webhookRes.statusText}`;
  }

  let email_server_ready: boolean | null = null;
  if (emailServerRes !== null) {
    if (emailServerRes.status === 200 && emailServerRes.data) {
      email_server_ready = true;
    } else if (emailServerRes.status === 404) {
      email_server_ready = false;
    } else {
      errors.email_server = `${emailServerRes.status} ${emailServerRes.statusText}`;
    }
  }

  return {
    settings: {
      trusted_origins,
      allow_localhost,
      auth_methods: { email_password },
      plugins: { magic_link, phone_number, organization },
      webhook,
      email_server_ready,
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
  // `getNeonAuthEmailServer` is best-effort — older Neon Auth integrations
  // never had email server state and the route can 404. We catch hard errors
  // (network / typed client throw) here so we still return a partial snapshot.
  const emailServerPromise = neonClient
    .getNeonAuthEmailServer(projectId)
    .then((res) => res as Slice<unknown>)
    .catch(
      () =>
        ({
          status: 0,
          statusText: 'request failed',
        }) as Slice<unknown>,
    );

  const [
    domainsRes,
    localhostRes,
    emailRes,
    pluginsRes,
    webhookRes,
    emailServerRes,
  ] = await Promise.all([
    neonClient.listBranchNeonAuthTrustedDomains(projectId, branchId),
    neonClient.getNeonAuthAllowLocalhost(projectId, branchId),
    neonClient.getNeonAuthEmailAndPasswordConfig(projectId, branchId),
    neonClient.getNeonAuthPluginConfigs(projectId, branchId),
    neonClient.getNeonAuthWebhookConfig(projectId, branchId),
    emailServerPromise,
  ]);
  return buildNeonAuthConfigurableSettingsFromSlices(
    domainsRes,
    localhostRes,
    emailRes,
    pluginsRes,
    webhookRes,
    emailServerRes,
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
