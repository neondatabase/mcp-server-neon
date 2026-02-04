/**
 * RFC 8252 loopback redirect URI matching.
 * Loopback hosts (localhost, 127.0.0.1, ::1) are treated as equivalent with flexible ports.
 * Non-loopback URIs use strict string matching per RFC 6749.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '');
  return LOOPBACK_HOSTS.has(host.toLowerCase()) || normalized === '::1';
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

function urisMatch(requestUri: string, registeredUri: string): boolean {
  const request = parseUri(requestUri);
  const registered = parseUri(registeredUri);

  if (!request || !registered) {
    return requestUri === registeredUri;
  }

  // Loopback equivalence only applies when BOTH are loopback
  if (request.isLoopback && registered.isLoopback) {
    return request.scheme === registered.scheme && request.path === registered.path;
  }

  return requestUri === registeredUri;
}

export function matchesRedirectUri(
  requestUri: string,
  registeredUris: string[],
): boolean {
  return registeredUris.some((registered) => urisMatch(requestUri, registered));
}
