import { Api, NeonAuthEmailAndPasswordConfig } from '@neondatabase/api-client';

/**
 * Canonical Neon Auth settings shape shared by get_neon_auth_config and
 * configure_neon_auth success responses (same keys configure reads/writes).
 */
type NeonAuthConfigurableSettings = {
  trusted_redirect_uris: string[];
  allow_localhost: boolean | null;
  sign_in_with_email: boolean | null;
  verify_email_on_sign_up: boolean | null;
  allow_sign_up_with_email: boolean | null;
};

type NeonAuthConfigurableSettingsErrors = Partial<{
  trusted_redirect_uris: string;
  allow_localhost: string;
  email_auth: string;
}>;

type Slice<T> = { status: number; statusText: string; data?: T };

function buildNeonAuthConfigurableSettingsFromSlices(
  domainsRes: Slice<{ domains: { domain: string }[] }>,
  localhostRes: Slice<{ allow_localhost: boolean }>,
  emailRes: Slice<NeonAuthEmailAndPasswordConfig>,
): {
  settings: NeonAuthConfigurableSettings;
  errors: NeonAuthConfigurableSettingsErrors;
} {
  const errors: NeonAuthConfigurableSettingsErrors = {};

  let trusted_redirect_uris: string[] = [];
  if (domainsRes.status === 200 && domainsRes.data) {
    trusted_redirect_uris = domainsRes.data.domains.map((d) => d.domain);
  } else {
    errors.trusted_redirect_uris = `${domainsRes.status} ${domainsRes.statusText}`;
  }

  let allow_localhost: boolean | null = null;
  if (localhostRes.status === 200 && localhostRes.data) {
    allow_localhost = localhostRes.data.allow_localhost;
  } else {
    errors.allow_localhost = `${localhostRes.status} ${localhostRes.statusText}`;
  }

  let sign_in_with_email: boolean | null = null;
  let verify_email_on_sign_up: boolean | null = null;
  let allow_sign_up_with_email: boolean | null = null;
  if (emailRes.status === 200 && emailRes.data) {
    const e = emailRes.data;
    sign_in_with_email = e.enabled;
    verify_email_on_sign_up = e.send_verification_email_on_sign_up;
    allow_sign_up_with_email = !e.disable_sign_up;
  } else {
    errors.email_auth = `${emailRes.status} ${emailRes.statusText}`;
  }

  return {
    settings: {
      trusted_redirect_uris,
      allow_localhost,
      sign_in_with_email,
      verify_email_on_sign_up,
      allow_sign_up_with_email,
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
