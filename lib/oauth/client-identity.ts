import { isLoopbackHost, isSupportedNativeRedirectUri } from './redirect-uri';

type TrustedOAuthPartner = {
  nameMatchers: readonly string[];
  displayName: string;
  redirectHosts: readonly string[];
};

const TRUSTED_OAUTH_PARTNERS: readonly TrustedOAuthPartner[] = [
  {
    nameMatchers: ['neon'],
    displayName: 'Neon',
    redirectHosts: ['neon.com', 'neon.tech'],
  },
  {
    nameMatchers: ['claude'],
    displayName: 'Claude',
    redirectHosts: ['claude.ai', 'anthropic.com'],
  },
  {
    nameMatchers: ['cursor'],
    displayName: 'Cursor',
    redirectHosts: ['cursor.com', 'cursor.sh'],
  },
  {
    nameMatchers: ['chatgpt', 'openai'],
    displayName: 'ChatGPT',
    redirectHosts: ['chatgpt.com', 'openai.com'],
  },
  {
    nameMatchers: ['perplexity'],
    displayName: 'Perplexity',
    redirectHosts: ['perplexity.ai'],
  },
];

type OAuthImpersonationWarning = {
  brandDisplayName: string;
  redirectHost: string;
};

function findPartnerByName(
  clientName: string | undefined,
): TrustedOAuthPartner | undefined {
  if (!clientName) {
    return undefined;
  }
  const normalizedName = clientName.toLowerCase();
  return TRUSTED_OAUTH_PARTNERS.find((partner) =>
    partner.nameMatchers.some((matcher) => normalizedName.includes(matcher)),
  );
}

function hostMatches(
  hostname: string,
  allowedHosts: readonly string[],
): boolean {
  const normalizedHost = hostname.replace(/\.$/, '').toLowerCase();
  return allowedHosts.some(
    (allowedHost) =>
      normalizedHost === allowedHost ||
      normalizedHost.endsWith(`.${allowedHost}`),
  );
}

export function getOAuthImpersonationWarning({
  clientName,
  redirectUri,
}: {
  clientName: string | undefined;
  redirectUri: string;
}): OAuthImpersonationWarning | undefined {
  const partner = findPartnerByName(clientName);
  if (!partner) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return undefined;
  }

  if (isLoopbackHost(parsed.hostname)) {
    return undefined;
  }
  if (
    partner.displayName === 'Cursor' &&
    isSupportedNativeRedirectUri(redirectUri)
  ) {
    return undefined;
  }
  if (
    parsed.protocol === 'https:' &&
    hostMatches(parsed.hostname, partner.redirectHosts)
  ) {
    return undefined;
  }

  return {
    brandDisplayName: partner.displayName,
    redirectHost: parsed.hostname,
  };
}
