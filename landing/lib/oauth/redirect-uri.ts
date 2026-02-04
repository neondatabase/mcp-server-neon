/**
 * RFC 8252 loopback redirect URI matching.
 * Loopback hosts (localhost, 127.0.0.1, ::1) are treated as equivalent with flexible ports.
 * Non-loopback URIs use strict string matching per RFC 6749.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function isLoopbackHost(host: string): boolean {
 return LOOPBACK_HOSTS.has(host.toLowerCase());    
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
    return request.scheme === registered.scheme && request.path === registered.path;
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
