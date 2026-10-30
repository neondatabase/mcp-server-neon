/**
 * `private_key_jwt` client authentication (RFC 7523 §2.2) for clients that
 * declare it, such as ChatGPT's Client ID Metadata Document. The client signs
 * a short-lived JWT with a key published at its `jwks_uri` (or inline `jwks`).
 */

import {
  createLocalJWKSet,
  decodeJwt,
  errors,
  jwtVerify,
  type JSONWebKeySet,
} from 'jose';
import type { Client } from 'oauth2-server';
import { SERVER_HOST } from '../config';
import { logger } from '../../mcp/utils/logger';
import {
  cacheTtlMs,
  ClientMetadataUnavailableError,
  fetchOverHttps,
  isJson,
  MetadataDocumentRefusedError,
  type FetchMetadataDocument,
} from './client-id-metadata-document';

export const CLIENT_ASSERTION_TYPE =
  'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

export const CLIENT_ASSERTION_SIGNING_ALGORITHMS = [
  'RS256',
  'PS256',
  'ES256',
  'EdDSA',
];

const CLOCK_TOLERANCE_S = 30;
const MAX_CACHE_ENTRIES = 1_000;
const MAX_LIFETIME_S = 5 * 60;

/** The `iss` of an unverified assertion, for requests that omit client_id. */
export function clientIdFromAssertion(assertion: string): string | undefined {
  try {
    const { iss } = decodeJwt(assertion);
    return typeof iss === 'string' ? iss : undefined;
  } catch {
    return undefined;
  }
}

function isJwks(value: unknown): value is JSONWebKeySet {
  return (
    typeof value === 'object' &&
    value !== null &&
    'keys' in value &&
    Array.isArray(value.keys)
  );
}

export function createClientAssertionVerifier(
  fetchDocument: FetchMetadataDocument = fetchOverHttps,
  now: () => number = Date.now,
) {
  const cache = new Map<string, { jwks: JSONWebKeySet; until: number }>();

  // Unreadable (5xx, 429, network) throws ClientMetadataUnavailableError so
  // the endpoint answers 503; anything else is a failed authentication.
  const loadJwks = async (
    jwksUri: string,
    fresh: boolean,
  ): Promise<JSONWebKeySet | undefined> => {
    const cached = cache.get(jwksUri);
    if (!fresh && cached && cached.until > now()) return cached.jwks;

    let url: URL;
    try {
      url = new URL(jwksUri);
    } catch {
      return undefined;
    }
    if (url.protocol !== 'https:') return undefined;

    let res;
    try {
      res = await fetchDocument(url);
    } catch (error) {
      if (error instanceof MetadataDocumentRefusedError) return undefined;
      throw new ClientMetadataUnavailableError(
        error instanceof Error ? error.message : String(error),
      );
    }
    if (res.status >= 500 || res.status === 429) {
      throw new ClientMetadataUnavailableError(`answered ${res.status}`);
    }
    if (res.status !== 200 || !isJson(res.contentType)) return undefined;

    let jwks: unknown;
    try {
      jwks = JSON.parse(res.body);
    } catch {
      return undefined;
    }
    if (!isJwks(jwks)) return undefined;

    const ttl = cacheTtlMs(res.cacheControl);
    if (ttl > 0) {
      cache.delete(jwksUri);
      const oldest = cache.keys().next();
      if (cache.size >= MAX_CACHE_ENTRIES && !oldest.done) {
        cache.delete(oldest.value);
      }
      cache.set(jwksUri, { jwks, until: now() + ttl });
    }
    return jwks;
  };

  const verifyWith = async (
    jwks: JSONWebKeySet,
    assertion: string,
    clientId: string,
  ): Promise<boolean> => {
    const { payload } = await jwtVerify(assertion, createLocalJWKSet(jwks), {
      issuer: clientId,
      subject: clientId,
      audience: [
        SERVER_HOST,
        `${SERVER_HOST}/api/token`,
        `${SERVER_HOST}/api/revoke`,
      ],
      algorithms: CLIENT_ASSERTION_SIGNING_ALGORITHMS,
      requiredClaims: ['exp'],
      clockTolerance: CLOCK_TOLERANCE_S,
      currentDate: new Date(now()),
    });
    const exp = payload.exp ?? 0;
    return exp <= now() / 1000 + MAX_LIFETIME_S + CLOCK_TOLERANCE_S;
  };

  return async (
    client: Client,
    assertion: string | undefined,
    assertionType: string | undefined,
  ): Promise<boolean> => {
    if (!assertion || assertionType !== CLIENT_ASSERTION_TYPE) return false;

    const jwksUri =
      typeof client.jwks_uri === 'string' ? client.jwks_uri : undefined;
    const inline = isJwks(client.jwks) ? client.jwks : undefined;
    const jwks = jwksUri ? await loadJwks(jwksUri, false) : inline;
    if (!jwks) return false;

    try {
      return await verifyWith(jwks, assertion, client.id);
    } catch (error) {
      // A rotated key is not in the cached set yet.
      if (jwksUri && error instanceof errors.JWKSNoMatchingKey) {
        const refreshed = await loadJwks(jwksUri, true);
        if (refreshed) {
          try {
            return await verifyWith(refreshed, assertion, client.id);
          } catch {
            return false;
          }
        }
      }
      logger.warn('Client assertion rejected', {
        clientId: client.id,
        reason: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  };
}

export const verifyClientAssertion = createClientAssertionVerifier();
