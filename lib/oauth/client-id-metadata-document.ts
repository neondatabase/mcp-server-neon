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
 * Draft: https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document-00
 */

import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';
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

/** A fetch failure that retrying will not fix (blocked address, too large). */
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
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockedAddresses.addSubnet(address, prefix, 'ipv4');
}
for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
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
const publicOnlyLookup = ((
  hostname: string,
  options: { all?: boolean },
  callback: (
    err: Error | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
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
  });
}) as unknown as typeof dnsLookup;

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
        timeout: FETCH_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_DOCUMENT_BYTES) {
            req.destroy(
              new MetadataDocumentRefusedError(
                `document exceeds ${MAX_DOCUMENT_BYTES} bytes`,
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            contentType: res.headers['content-type'],
            cacheControl: res.headers['cache-control'],
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end();
  });

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
  // Rejects dot segments and anything else URL parsing would rewrite: the
  // document's client_id has to match this exact string.
  if (url.href !== clientId) return 'client_id is not in normalized form';
  return url;
}

/**
 * `token_endpoint_auth_method` names one method; the OpenID RP metadata field
 * `token_endpoint_auth_methods_supported` lists every method the client can
 * use (ChatGPT's document offers both `none` and `private_key_jwt`). With
 * neither present, a document that carries no secret can only be public.
 */
function offeredAuthMethods(doc: Record<string, unknown>): string[] {
  const methods = new Set<string>();
  if (typeof doc.token_endpoint_auth_method === 'string') {
    methods.add(doc.token_endpoint_auth_method);
  }
  if (Array.isArray(doc.token_endpoint_auth_methods_supported)) {
    for (const method of doc.token_endpoint_auth_methods_supported) {
      if (typeof method === 'string') methods.add(method);
    }
  }
  return methods.size === 0 ? ['none'] : [...methods];
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

function checkDocument(url: URL, doc: unknown, now: number): Client | string {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return 'document is not a JSON object';
  }
  const d = doc as Record<string, unknown>;

  if (d.client_id !== url.href) {
    return 'document client_id does not match its URL';
  }
  if ('client_secret' in d || 'client_secret_expires_at' in d) {
    return 'document must not contain a client secret';
  }
  const authMethods = offeredAuthMethods(d);
  if (authMethods.some((method) => method.startsWith('client_secret_'))) {
    return 'document must not offer a shared-secret auth method';
  }
  // Only public clients are served; PKCE protects their codes.
  if (!authMethods.includes('none')) {
    return 'document must offer token_endpoint_auth_method none';
  }
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
    id: url.href,
    client_name: d.client_name,
    // The consent page shows this as the client's website. The document's own
    // client_uri is self-asserted; the client_id's origin is the one thing
    // the fetch has verified.
    client_uri: url.origin,
    redirect_uris: redirectUris,
    grants: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    tokenEndpointAuthMethod: 'none',
    registrationDate: Math.floor(now / 1000),
  };
}

function cacheTtlMs(cacheControl: string | undefined): number {
  if (!cacheControl) return DEFAULT_CACHE_TTL_MS;
  if (/\b(no-store|no-cache)\b/i.test(cacheControl)) return 0;
  const maxAge = /\bmax-age=(\d+)/i.exec(cacheControl);
  if (!maxAge) return DEFAULT_CACHE_TTL_MS;
  return Math.min(Number(maxAge[1]) * 1000, MAX_CACHE_TTL_MS);
}

const isJson = (contentType: string | undefined): boolean =>
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

    const client = checkDocument(url, doc, now());
    if (typeof client === 'string') return refuse(clientId, client);

    const ttl = cacheTtlMs(res.cacheControl);
    if (ttl > 0) {
      if (cache.size >= MAX_CACHE_ENTRIES) {
        cache.delete(cache.keys().next().value as string);
      }
      cache.set(clientId, { client, until: now() + ttl });
    }
    return client;
  };
}

export const resolveClientIdMetadataDocument = createClientMetadataResolver();
