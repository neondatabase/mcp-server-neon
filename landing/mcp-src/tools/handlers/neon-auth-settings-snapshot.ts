import {
  Api,
  NeonAuthEmailAndPasswordConfig,
  NeonAuthEmailServerConfig,
  NeonAuthEmailVerificationMethod,
  NeonAuthOauthProvider,
  NeonAuthOauthProviderId,
  NeonAuthOauthProviderType,
  NeonAuthOrganizationConfig,
  NeonAuthPluginConfigs,
  NeonAuthWebhookConfig,
} from '@neondatabase/api-client';
import { isAxiosError } from 'axios';

const REDACTED_SECRET = '***redacted***' as const;

type EmailPasswordSnapshot = {
  enabled: boolean;
  allow_sign_up: boolean;
  verify_email_on_sign_up: boolean;
  verify_email_on_sign_in: boolean;
  email_verification_method: NeonAuthEmailVerificationMethod;
  require_email_verification: boolean;
  auto_sign_in_after_verification: boolean;
};

type OAuthProviderSnapshot = {
  id: NeonAuthOauthProviderId;
  type: NeonAuthOauthProviderType;
  client_id: string | null;
  client_secret: typeof REDACTED_SECRET | null;
};

type EmailDeliverySnapshot =
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
  sign_in_methods: {
    email_password: EmailPasswordSnapshot | null;
    magic_link: UnavailableSnapshot;
    phone: UnavailableSnapshot;
  };
  organizations: NeonAuthOrganizationConfig | null;
  app: { app_name: string | null };
  webhook: NeonAuthWebhookConfig | null;
  oauth_providers: OAuthProviderSnapshot[];
  email_delivery: EmailDeliverySnapshot | null;
};

type NeonAuthConfigurableSettingsErrors = Partial<{
  trusted_origins: string;
  allow_localhost: string;
  email_password: string;
  organizations: string;
  app: string;
  webhook: string;
  oauth_providers: string;
  email_delivery: string;
}>;

type Slice<T> = { status: number; statusText: string; data?: T };

type UnavailableSnapshot = {
  status: 'unavailable';
  reason: string;
};

const NO_PUBLIC_READ_ENDPOINT: UnavailableSnapshot = {
  status: 'unavailable',
  reason: 'No public read endpoint is currently exposed for this slice.',
};

function emailPasswordSnapshot(
  data: NeonAuthEmailAndPasswordConfig,
): EmailPasswordSnapshot {
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
  provider: NeonAuthOauthProvider,
): OAuthProviderSnapshot {
  return {
    id: provider.id,
    type: provider.type,
    client_id: provider.client_id ?? null,
    client_secret: provider.client_secret ? REDACTED_SECRET : null,
  };
}

function emailDeliverySnapshot(
  data: NeonAuthEmailServerConfig,
): EmailDeliverySnapshot {
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

const UPSTREAM_ERROR_SNIPPET_MAX_LEN = 200;

function summarizeAxiosErrorBody(data: unknown): string | undefined {
  let raw: string | undefined;
  if (typeof data === 'string') {
    raw = data;
  } else if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    raw =
      typeof obj.message === 'string'
        ? obj.message
        : typeof obj.error === 'string'
          ? obj.error
          : typeof obj.detail === 'string'
            ? obj.detail
            : undefined;
  }
  if (!raw) return undefined;
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]+/g, ' ').trim();
  if (cleaned.length === 0) return undefined;
  return cleaned.length > UPSTREAM_ERROR_SNIPPET_MAX_LEN
    ? `${cleaned.slice(0, UPSTREAM_ERROR_SNIPPET_MAX_LEN)}...`
    : cleaned;
}

async function safeFetch<T>(
  fetcher: () => Promise<Slice<T>>,
): Promise<Slice<T>> {
  try {
    return await fetcher();
  } catch (err) {
    if (isAxiosError(err) && err.response) {
      const { status, statusText, data } = err.response;
      const snippet = summarizeAxiosErrorBody(data);
      return {
        status,
        statusText: snippet ? `${statusText}: ${snippet}` : statusText,
      };
    }
    throw err;
  }
}

async function safeFetchAppConfig(
  neonClient: Api<unknown>,
  projectId: string,
  branchId: string,
): Promise<Slice<{ app_name?: string }>> {
  return safeFetch(async () => {
    const res = await neonClient.request({
      path: `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(
        branchId,
      )}/auth/config`,
      method: 'GET',
      secure: true,
      format: 'json',
    });
    const data =
      res.data && typeof res.data === 'object'
        ? (res.data as { app_name?: string })
        : undefined;
    return { status: res.status, statusText: res.statusText, data };
  });
}

export async function fetchNeonAuthConfigurableSettings(
  neonClient: Api<unknown>,
  projectId: string,
  branchId: string,
): Promise<{
  settings: NeonAuthConfigurableSettings;
  errors: NeonAuthConfigurableSettingsErrors;
}> {
  const [domainsRes, pluginConfigsRes, webhookRes, appConfigRes] =
    await Promise.all([
      safeFetch(() =>
        neonClient.listBranchNeonAuthTrustedDomains(projectId, branchId),
      ),
      safeFetch(() =>
        neonClient.getNeonAuthPluginConfigs(projectId, branchId),
      ) as Promise<Slice<NeonAuthPluginConfigs>>,
      safeFetch(() =>
        neonClient.getNeonAuthWebhookConfig(projectId, branchId),
      ) as Promise<Slice<NeonAuthWebhookConfig>>,
      safeFetchAppConfig(neonClient, projectId, branchId),
    ]);

  const errors: NeonAuthConfigurableSettingsErrors = {};

  let trusted_origins: string[] = [];
  if (domainsRes.status === 200 && domainsRes.data) {
    trusted_origins = domainsRes.data.domains.map((d) => d.domain);
  } else {
    errors.trusted_origins = `${domainsRes.status} ${domainsRes.statusText}`;
  }

  const pluginConfigs =
    pluginConfigsRes.status === 200 ? pluginConfigsRes.data : undefined;

  let email_password: EmailPasswordSnapshot | null = null;
  if (pluginConfigs?.email_and_password) {
    email_password = emailPasswordSnapshot(pluginConfigs.email_and_password);
  }

  let oauth_providers: OAuthProviderSnapshot[] = [];
  if (pluginConfigs?.oauth_providers) {
    oauth_providers = pluginConfigs.oauth_providers.map(oauthProviderSnapshot);
  }

  let email_delivery: EmailDeliverySnapshot | null = null;
  if (pluginConfigs?.email_provider) {
    email_delivery = emailDeliverySnapshot(pluginConfigs.email_provider);
  }

  const organizations = pluginConfigs?.organization ?? null;
  const allow_localhost = pluginConfigs?.allow_localhost ?? null;

  if (pluginConfigsRes.status !== 200) {
    const error = `${pluginConfigsRes.status} ${pluginConfigsRes.statusText}`;
    errors.allow_localhost = error;
    errors.email_password = error;
    errors.oauth_providers = error;
    errors.email_delivery = error;
    errors.organizations = error;
  }

  let webhook: NeonAuthWebhookConfig | null = null;
  if (webhookRes.status === 200 && webhookRes.data) {
    webhook = webhookRes.data;
  } else if (webhookRes.status !== 404) {
    errors.webhook = `${webhookRes.status} ${webhookRes.statusText}`;
  }

  const app = { app_name: appConfigRes.data?.app_name ?? null };
  if (appConfigRes.status !== 200 && appConfigRes.status !== 404) {
    errors.app = `${appConfigRes.status} ${appConfigRes.statusText}`;
  }

  return {
    settings: {
      trusted_origins,
      allow_localhost,
      sign_in_methods: {
        email_password,
        magic_link: NO_PUBLIC_READ_ENDPOINT,
        phone: NO_PUBLIC_READ_ENDPOINT,
      },
      organizations,
      app,
      webhook,
      oauth_providers,
      email_delivery,
    },
    errors,
  };
}

export async function fetchOAuthProvidersSlice(
  neonClient: Api<unknown>,
  projectId: string,
  branchId: string,
): Promise<{ providers: OAuthProviderSnapshot[]; error?: string }> {
  const res = await safeFetch(() =>
    neonClient.listBranchNeonAuthOauthProviders(projectId, branchId),
  );
  if (res.status === 200 && res.data) {
    return { providers: res.data.providers.map(oauthProviderSnapshot) };
  }
  return { providers: [], error: `${res.status} ${res.statusText}` };
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
