/**
 * OAuth Client ID Metadata Documents (CIMD).
 *
 * MCP 2026-07-28 makes CIMD the preferred way for a client to identify itself
 * (SHOULD) and keeps Dynamic Client Registration only for backwards
 * compatibility. The client's `client_id` is an https URL serving a JSON
 * document that describes it; there is no `/api/register` call and nothing is
 * stored.
 *
 * Spec: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration#client-id-metadata-documents
 * Draft: https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document-02
 */

import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import type { IncomingHttpHeaders } from 'node:http';
import { request } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import type { Readable } from 'node:stream';
import type { Client } from 'oauth2-server';
import { normalizeRedirectUris } from './redirect-uri';
import { logger } from '../../mcp/utils/logger';

const FETCH_TIMEOUT_MS = 5_000;
// The draft recommends 5 KB.
const MAX_DOCUMENT_BYTES = 5 * 1024;
const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const MAX_CACHE_TTL_MS = 24 * 60 * 60_000;
const MAX_CACHE_ENTRIES = 1_000;
const DANGEROUS_REDIRECT_SCHEMES = new Set([
  'javascript:',
  'data:',
  'vbscript:',
  'file:',
]);

export type MetadataDocumentResponse = {
  status: number;
  contentType: string | undefined;
  cacheControl: string | undefined;
  body: string;
};

export type FetchMetadataDocument = (
  url: URL,
) => Promise<MetadataDocumentResponse>;

/**
 * A fetch failure that retrying will not fix (blocked address, too large, a
 * name that does not resolve, an invalid certificate).
 */
export class MetadataDocumentRefusedError extends Error {}

/**
 * The document could not be read right now (timeout, connection error, 5xx).
 * Answered as 503 rather than `invalid_client`: a client told its client_id is
 * invalid during the document host's outage would throw away working
 * credentials.
 */
export class ClientMetadataUnavailableError extends Error {}

/** Registered client IDs are short random strings, so an https URL is CIMD. */
export function isClientIdMetadataUrl(clientId: string): boolean {
  return clientId.startsWith('https://');
}

// The document URL is chosen by whoever calls /api/authorize, so fetching it
// must not reach anything inside the network this server runs in (SSRF).
// Node's BlockList also matches IPv4-mapped IPv6 addresses against the IPv4
// rules, so `::ffff:10.0.0.1` is covered without a separate entry.
const blockedAddresses = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockedAddresses.addSubnet(address, prefix, 'ipv4');
}
for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  // IETF protocol assignments, including Teredo (2001::/32), which tunnels
  // to an arbitrary IPv4 address.
  ['2001::', 23],
  ['2001:db8::', 32],
  // 6to4 embeds an IPv4 address, including private ones.
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blockedAddresses.addSubnet(address, prefix, 'ipv6');
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  return blockedAddresses.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

// Checked inside the connection's own lookup rather than before the request,
// so a hostname cannot resolve to a public address for the check and to a
// private one for the connection (DNS rebinding).
const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(
    hostname,
    { ...options, all: true },
    (err, addresses: LookupAddress[]) => {
      if (err) return callback(err, []);
      if (addresses.some((a) => isBlockedAddress(a.address))) {
        return callback(
          new MetadataDocumentRefusedError(
            `${hostname} resolves to a non-public address`,
          ),
          [],
        );
      }
      if (options.all) return callback(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    },
  );
};

type DocumentStream = Readable & {
  statusCode?: number;
  headers: IncomingHttpHeaders;
};

/**
 * Only a 200 body is read, so an error page larger than the cap still
 * reports its status (a 503 stays retryable instead of reading as refused).
 */
export function readDocument(
  res: DocumentStream,
): Promise<MetadataDocumentResponse> {
  const head = {
    status: res.statusCode ?? 0,
    contentType: res.headers['content-type'],
    cacheControl: res.headers['cache-control'],
  };
  if (head.status !== 200) {
    res.destroy();
    return Promise.resolve({ ...head, body: '' });
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    res.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_DOCUMENT_BYTES) {
        res.destroy();
        reject(
          new MetadataDocumentRefusedError(
            `document exceeds ${MAX_DOCUMENT_BYTES} bytes`,
          ),
        );
        return;
      }
      chunks.push(chunk);
    });
    res.on('end', () =>
      resolve({ ...head, body: Buffer.concat(chunks).toString('utf8') }),
    );
    res.on('error', reject);
  });
}

/** Never follows redirects: `https.request` does not. */
export const fetchOverHttps: FetchMetadataDocument = (url) =>
  new Promise((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) !== 0 && isBlockedAddress(host)) {
      reject(new MetadataDocumentRefusedError(`${host} is not public`));
      return;
    }

    const req = request(
      url,
      {
        method: 'GET',
        headers: { accept: 'application/json' },
        lookup: publicOnlyLookup,
        // A deadline over DNS, connect, and the whole body; a socket
        // inactivity timeout would let a host trickle bytes indefinitely.
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
      (res) => {
        readDocument(res).then(resolve, (error: unknown) => {
          req.destroy();
          reject(error);
        });
      },
    );
    req.on('error', (error) =>
      reject(
        isPermanentFetchError(error)
          ? new MetadataDocumentRefusedError(error.message)
          : error,
      ),
    );
    req.end();
  });

// A name that does not resolve, or a certificate that does not verify, will
// fail the same way on every retry: the client_id is wrong, not the document
// host briefly down. EAI_AGAIN (resolver unavailable), timeouts, resets and
// refused connections stay retryable.
const PERMANENT_FETCH_ERROR_CODES = new Set([
  'ENOTFOUND',
  'ENODATA',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_REVOKED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

export function isPermanentFetchError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    PERMANENT_FETCH_ERROR_CODES.has(error.code)
  );
}

function hasDotSegment(clientId: string): boolean {
  const path = /^https:\/\/[^/?#]*([^?#]*)/i.exec(clientId)?.[1] ?? '';
  return path.split('/').some((segment) => /^(\.|%2e){1,2}$/i.test(segment));
}

/**
 * The client_id is compared to the document's `client_id` as the exact string
 * the client sent, so it is validated without being normalized: an explicit
 * `:443` is a different identifier from the portless one.
 */
function checkClientIdUrl(clientId: string): URL | string {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return 'client_id is not a URL';
  }
  if (url.protocol !== 'https:') return 'client_id must use https';
  if (url.username || url.password) {
    return 'client_id must not carry credentials';
  }
  if (clientId.includes('#')) return 'client_id must not have a fragment';
  if (url.pathname === '/') return 'client_id must have a path';
  if (hasDotSegment(clientId)) return 'client_id must not have dot segments';
  return url;
}

type DocumentAuth =
  | { tokenEndpointAuthMethod: 'none' }
  | {
      tokenEndpointAuthMethod: 'private_key_jwt';
      jwks_uri?: string;
      jwks?: Record<string, unknown>;
    };

/**
 * `token_endpoint_auth_method` is the method the client declared. A declared
 * `private_key_jwt` is enforced (CIMD draft §8.2) even when the OpenID RP
 * field `token_endpoint_auth_methods_supported` also lists `none`, as
 * ChatGPT's document does. With no declaration, a document that offers `none`
 * or lists no method is a public client.
 */
function documentAuth(d: Record<string, unknown>): DocumentAuth | string {
  const declared = d.token_endpoint_auth_method;
  if (declared === 'private_key_jwt') {
    if (typeof d.jwks_uri === 'string') {
      let jwksUri: URL;
      try {
        jwksUri = new URL(d.jwks_uri);
      } catch {
        return 'jwks_uri is not a URL';
      }
      if (jwksUri.protocol !== 'https:') return 'jwks_uri must use https';
      return {
        tokenEndpointAuthMethod: 'private_key_jwt',
        jwks_uri: d.jwks_uri,
      };
    }
    if (isJsonObject(d.jwks) && Array.isArray(d.jwks.keys)) {
      return { tokenEndpointAuthMethod: 'private_key_jwt', jwks: d.jwks };
    }
    return 'private_key_jwt requires jwks_uri or jwks';
  }
  if (declared === 'none') return { tokenEndpointAuthMethod: 'none' };
  if (declared !== undefined) {
    return 'token_endpoint_auth_method must be none or private_key_jwt';
  }
  const supported = d.token_endpoint_auth_methods_supported;
  if (supported === undefined) return { tokenEndpointAuthMethod: 'none' };
  if (Array.isArray(supported) && supported.includes('none')) {
    return { tokenEndpointAuthMethod: 'none' };
  }
  return 'document must offer token_endpoint_auth_method none or private_key_jwt';
}

function hasDangerousRedirectUri(redirectUris: string[]): boolean {
  return redirectUris.some((uri) => {
    try {
      return DANGEROUS_REDIRECT_SCHEMES.has(new URL(uri).protocol);
    } catch {
      return true;
    }
  });
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkDocument(
  clientId: string,
  url: URL,
  d: unknown,
  now: number,
): Client | string {
  if (!isJsonObject(d)) {
    return 'document is not a JSON object';
  }

  if (d.client_id !== clientId) {
    return 'document client_id does not match its URL';
  }
  if ('client_secret' in d || 'client_secret_expires_at' in d) {
    return 'document must not contain a client secret';
  }
  const auth = documentAuth(d);
  if (typeof auth === 'string') return auth;
  if (typeof d.client_name !== 'string' || d.client_name === '') {
    return 'document must have a client_name';
  }

  // Same leniency as /api/register (native app schemes such as cursor:// are
  // accepted), except for schemes that could never be a callback.
  const redirectUris = normalizeRedirectUris(d.redirect_uris);
  if (!redirectUris) return 'document must have redirect_uris';
  if (hasDangerousRedirectUri(redirectUris)) {
    return 'document lists a redirect_uri that is not allowed';
  }

  return {
    id: clientId,
    client_name: d.client_name,
    // The consent page shows this as the client's website. The document's own
    // client_uri is self-asserted; the client_id's origin is the one thing
    // the fetch has verified.
    client_uri: url.origin,
    redirect_uris: redirectUris,
    grants: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    ...auth,
    registrationDate: Math.floor(now / 1000),
  };
}

export function cacheTtlMs(cacheControl: string | undefined): number {
  if (!cacheControl) return DEFAULT_CACHE_TTL_MS;
  if (/\b(no-store|no-cache)\b/i.test(cacheControl)) return 0;
  const maxAge = /\bmax-age=(\d+)/i.exec(cacheControl);
  if (!maxAge) return DEFAULT_CACHE_TTL_MS;
  return Math.min(Number(maxAge[1]) * 1000, MAX_CACHE_TTL_MS);
}

export const isJson = (contentType: string | undefined): boolean =>
  /^application\/([\w.-]+\+)?json\b/i.test(contentType ?? '');

/**
 * Resolves a URL client_id to a public client, or undefined when the document
 * is refused (callers answer that as an unknown client). Throws
 * ClientMetadataUnavailableError when the document could not be read right
 * now. Valid documents are cached per Cache-Control; refusals never are.
 */
export function createClientMetadataResolver(
  fetchDocument: FetchMetadataDocument = fetchOverHttps,
  now: () => number = Date.now,
): (clientId: string) => Promise<Client | undefined> {
  const cache = new Map<string, { client: Client; until: number }>();

  const refuse = (clientId: string, reason: string) => {
    logger.warn('Refused client ID metadata document', { clientId, reason });
    return undefined;
  };

  return async (clientId) => {
    const url = checkClientIdUrl(clientId);
    if (typeof url === 'string') return refuse(clientId, url);

    const cached = cache.get(clientId);
    if (cached && cached.until > now()) return cached.client;
    cache.delete(clientId);

    let res: MetadataDocumentResponse;
    try {
      res = await fetchDocument(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof MetadataDocumentRefusedError) {
        return refuse(clientId, message);
      }
      logger.warn('Could not fetch client ID metadata document', {
        clientId,
        error: message,
      });
      throw new ClientMetadataUnavailableError(message);
    }
    if (res.status >= 500 || res.status === 429) {
      logger.warn('Client ID metadata document host is unavailable', {
        clientId,
        status: res.status,
      });
      throw new ClientMetadataUnavailableError(`answered ${res.status}`);
    }
    if (res.status !== 200) {
      return refuse(clientId, `answered ${res.status}`);
    }
    if (!isJson(res.contentType)) return refuse(clientId, 'not JSON');

    let doc: unknown;
    try {
      doc = JSON.parse(res.body);
    } catch {
      return refuse(clientId, 'not valid JSON');
    }

    const client = checkDocument(clientId, url, doc, now());
    if (typeof client === 'string') return refuse(clientId, client);

    const ttl = cacheTtlMs(res.cacheControl);
    if (ttl > 0) {
      const oldest = cache.keys().next();
      if (cache.size >= MAX_CACHE_ENTRIES && !oldest.done) {
        cache.delete(oldest.value);
      }
      cache.set(clientId, { client, until: now() + ttl });
    }
    return client;
  };
}

export const resolveClientIdMetadataDocument = createClientMetadataResolver();
