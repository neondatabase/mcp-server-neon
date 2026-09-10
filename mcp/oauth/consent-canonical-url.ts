/**
 * Upstream OAuth always returns to SERVER_HOST/callback. Consent cookies are
 * host-scoped, so the authorize page that sets them has to be that same host.
 * Use the request Host header: Next.js can rewrite 127.0.0.1 onto localhost in
 * nextUrl.origin while the cookie is still bound to the host the browser used.
 */
export function requestPublicOrigin(request: {
  nextUrl: { protocol: string; origin: string };
  headers: { get: (name: string) => string | null };
}): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const host = (forwardedHost ?? request.headers.get('host') ?? '')
    .split(',')[0]
    ?.trim();
  if (!host) {
    return request.nextUrl.origin;
  }
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const proto =
    forwardedProto?.split(',')[0]?.trim() ||
    (request.nextUrl.protocol === 'https:' ? 'https' : 'http');
  return `${proto}://${host}`;
}

export function consentCanonicalLocation(
  requestOrigin: string,
  pathAndSearch: string,
  serverHost: string,
): string | undefined {
  const canonicalOrigin = new URL(serverHost).origin;
  const incomingOrigin = new URL(requestOrigin).origin;
  if (incomingOrigin === canonicalOrigin) {
    return undefined;
  }
  return new URL(pathAndSearch, canonicalOrigin).href;
}
