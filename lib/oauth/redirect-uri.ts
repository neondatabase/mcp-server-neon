/**
 * RFC 8252 loopback redirect URI matching.
 * Loopback hosts (localhost, 127.0.0.1, ::1) are treated as equivalent with flexible ports.
 * Non-loopback URIs use strict string matching per RFC 6749.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const SUPPORTED_NATIVE_REDIRECT_URIS = new Set([
  'cursor://anysphere.cursor-mcp/oauth/callback',
]);

function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.replace(/\.$/, '').toLowerCase());
}

function isSupportedNativeRedirectUri(uri: string): boolean {
  return SUPPORTED_NATIVE_REDIRECT_URIS.has(uri);
}

export type RedirectUriRejectionReason =
  | 'malformed'
  | 'scheme_not_allowed'
  | 'http_not_loopback'
  | 'has_userinfo'
  | 'has_fragment';

export type RejectedRedirectUri = {
  /** `scheme:` plus `//host` when the URI has one, e.g. `cursor://anysphere.cursor-mcp`,
   *  `javascript:`, or `unparseable`. Never the full URI: it may carry userinfo. */
  label: string;
  reason: RedirectUriRejectionReason;
};

export type DcrRedirectUriAdmission = {
  admitted: string[];
  rejected: RejectedRedirectUri[];
};

function rejectionLabel(uri: string): string {
  try {
    const parsed = new URL(uri);
    if (parsed.host !== '') {
      return `${parsed.protocol}//${parsed.host}`;
    }
    return parsed.protocol;
  } catch {
    return 'unparseable';
  }
}

function classifyDcrRedirectUri(
  uri: string,
): RedirectUriRejectionReason | undefined {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return 'malformed';
  }

  if (
    parsed.protocol !== 'http:' &&
    parsed.protocol !== 'https:' &&
    !isSupportedNativeRedirectUri(uri)
  ) {
    return 'scheme_not_allowed';
  }

  if (parsed.hostname === '') {
    return 'malformed';
  }

  const host = parsed.hostname.replace(/\.$/, '').toLowerCase();
  if (parsed.protocol === 'http:' && !isLoopbackHost(host)) {
    return 'http_not_loopback';
  }

  if (parsed.username !== '' || parsed.password !== '') {
    return 'has_userinfo';
  }

  if (parsed.hash !== '') {
    return 'has_fragment';
  }

  return undefined;
}

export function admitDcrRedirectUris(uris: string[]): DcrRedirectUriAdmission {
  const admitted: string[] = [];
  const rejected: RejectedRedirectUri[] = [];

  for (const uri of uris) {
    const reason = classifyDcrRedirectUri(uri);
    if (reason === undefined) {
      admitted.push(uri);
    } else {
      rejected.push({ label: rejectionLabel(uri), reason });
    }
  }

  return { admitted, rejected };
}

function parseUri(uri: string) {
  try {
    const parsed = new URL(uri);
    return {
      scheme: parsed.protocol,
      path: parsed.pathname + parsed.search,
      isLoopback: isLoopbackHost(parsed.hostname),
    };
  } catch {
    return null;
  }
}

type ParsedUri = {
  scheme: string;
  path: string;
  isLoopback: boolean;
};

function urisMatch(
  requestUri: string,
  request: ParsedUri | null,
  registeredUri: string,
): boolean {
  const registered = parseUri(registeredUri);

  if (!request || !registered) {
    return requestUri === registeredUri;
  }

  // Loopback equivalence only applies when BOTH are loopback
  if (request.isLoopback && registered.isLoopback) {
    return (
      request.scheme === registered.scheme && request.path === registered.path
    );
  }

  return requestUri === registeredUri;
}

export function matchesRedirectUri(
  requestUri: string,
  registeredUris: string[],
): boolean {
  const request = parseUri(requestUri);
  return registeredUris.some((registered) =>
    urisMatch(requestUri, request, registered),
  );
}
