import { SERVER_HOST } from '@/lib/config';

export const PROTECTED_RESOURCE_METADATA_PATH =
  '/.well-known/oauth-protected-resource';

function normalizeServerOrigin(serverHost: string): URL {
  const trimmed = serverHost.trim();
  const withProtocol = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
  const normalized = new URL(withProtocol);

  normalized.protocol = 'https:';
  normalized.pathname = '/';
  normalized.search = '';
  normalized.hash = '';
  normalized.username = '';
  normalized.password = '';

  return normalized;
}

function toOriginString(serverHost: string): string {
  return normalizeServerOrigin(serverHost).origin;
}

function firstForwardedValue(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(',')[0]?.trim();
  return first || null;
}

function resolveRequestOrigin(
  request: Request,
  fallbackServerHost = SERVER_HOST,
): string {
  const requestUrl = new URL(request.url);
  const forwardedHost = firstForwardedValue(
    request.headers.get('x-forwarded-host'),
  );
  const hostHeader = firstForwardedValue(request.headers.get('host'));
  const authority = forwardedHost ?? hostHeader ?? requestUrl.host;
  if (!authority) {
    return toOriginString(fallbackServerHost);
  }

  const forwardedProto = firstForwardedValue(
    request.headers.get('x-forwarded-proto'),
  );
  const protocol = forwardedProto === 'https' ? 'https:' : 'https:';
  return new URL(`${protocol}//${authority}`).origin;
}

function composeResourceIdentifier(
  origin: string,
  pathname: string,
  search: string,
): string {
  if (pathname === '/' && !search) {
    return origin;
  }
  return `${origin}${pathname}${search}`;
}

/**
 * Validates an OAuth resource indicator and returns the parsed URL.
 * RFC 9728 requires absolute HTTPS resource identifiers with no fragment.
 */
export function parseResourceIdentifier(resource: string): URL {
  const resourceUrl = new URL(resource);
  if (resourceUrl.protocol !== 'https:') {
    throw new Error('OAuth resource URI must use HTTPS');
  }
  if (resourceUrl.hash) {
    throw new Error('OAuth resource URI must not include a fragment');
  }
  return resourceUrl;
}

/**
 * Host-level protected resource metadata endpoint response identifier.
 */
export function getHostLevelResourceIdentifier(
  serverHost = SERVER_HOST,
): string {
  return toOriginString(serverHost);
}

export function getHostLevelResourceIdentifierFromRequest(
  request: Request,
  fallbackServerHost = SERVER_HOST,
): string {
  return resolveRequestOrigin(request, fallbackServerHost);
}

/**
 * Derives the protected resource identifier from a metadata request URL.
 * Example:
 * /.well-known/oauth-protected-resource/mcp?readonly=true
 * -> https://host/mcp?readonly=true
 */
export function deriveResourceIdentifierFromMetadataRequest(
  request: Request,
  fallbackServerHost = SERVER_HOST,
): string {
  const url = new URL(request.url);
  const origin = resolveRequestOrigin(request, fallbackServerHost);

  if (url.pathname === PROTECTED_RESOURCE_METADATA_PATH) {
    return getHostLevelResourceIdentifierFromRequest(
      request,
      fallbackServerHost,
    );
  }

  const derivedPrefix = `${PROTECTED_RESOURCE_METADATA_PATH}/`;
  if (!url.pathname.startsWith(derivedPrefix)) {
    throw new Error(
      'Request URL is not a protected resource metadata endpoint',
    );
  }

  const resourcePath = `/${url.pathname.slice(derivedPrefix.length)}`;
  return composeResourceIdentifier(origin, resourcePath, url.search);
}

/**
 * Builds the `resource_metadata` URL for a given protected resource request URL.
 * Example:
 * https://host/mcp?readonly=true
 * -> https://host/.well-known/oauth-protected-resource/mcp?readonly=true
 */
export function buildResourceMetadataUrlForResourceRequest(
  request: Request,
  fallbackServerHost = SERVER_HOST,
): string {
  const url = new URL(request.url);
  const origin = resolveRequestOrigin(request, fallbackServerHost);

  if (url.pathname === '/' && !url.search) {
    return `${origin}${PROTECTED_RESOURCE_METADATA_PATH}`;
  }

  return `${origin}${PROTECTED_RESOURCE_METADATA_PATH}${url.pathname}${url.search}`;
}
