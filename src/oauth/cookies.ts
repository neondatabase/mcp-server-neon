import {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from 'express';

const COOKIE_NAME = 'approved-mcp-clients';
const ONE_YEAR_IN_SECONDS = 365 * 24 * 60 * 60 * 1000; // 365 days

/**
 * Imports a secret key string for HMAC-SHA256 signing.
 * @param secret - The raw secret key string.
 * @returns A promise resolving to the CryptoKey object.
 */
const importKey = async (secret: string): Promise<CryptoKey> => {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
};

/**
 * Signs data using HMAC-SHA256.
 * @param key - The CryptoKey for signing.
 * @param data - The string data to sign.
 * @returns A promise resolving to the signature as a hex string.
 */
const signData = async (key: CryptoKey, data: string): Promise<string> => {
  const enc = new TextEncoder();
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    enc.encode(data),
  );
  // Convert ArrayBuffer to hex string
  return Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

/**
 * Verifies an HMAC-SHA256 signature.
 * @param key - The CryptoKey for verification.
 * @param signatureHex - The signature to verify (hex string).
 * @param data - The original data that was signed.
 * @returns A promise resolving to true if the signature is valid, false otherwise.
 */
const verifySignature = async (
  key: CryptoKey,
  signatureHex: string,
  data: string,
): Promise<boolean> => {
  try {
    // Convert hex signature back to ArrayBuffer
    const enc = new TextEncoder();
    const signatureBytes = new Uint8Array(
      signatureHex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) ?? [],
    );

    return await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes.buffer,
      enc.encode(data),
    );
  } catch (e) {
    // Handle errors during hex parsing or verification
    console.error('Error verifying signature:', e);
    return false;
  }
};

/**
 * Parses the signed cookie and verifies its integrity.
 * @param cookieHeader - The value of the Cookie header from the request.
 * @param secret - The secret key used for signing.
 * @returns A promise resolving to the list of approved client IDs if the cookie is valid, otherwise null.
 */
const getApprovedClientsFromCookie = async (
  cookie: string,
  secret: string,
): Promise<string[]> => {
  if (!cookie) return [];

  try {
    const [signatureHex, base64Payload] = cookie.split('.');
    if (!signatureHex || !base64Payload) return [];

    const payload = atob(base64Payload);
    const key = await importKey(secret);
    const isValid = await verifySignature(key, signatureHex, payload);
    if (!isValid) return [];

    const clients = JSON.parse(payload);
    return Array.isArray(clients) ? clients : [];
  } catch {
    return [];
  }
};

/**
 * Checks if a given client has already been approved by the user,
 * based on a signed cookie.
 *
 * @param request - The incoming Request object to read cookies from.
 * @param clientId - The OAuth client ID to check approval for.
 * @param cookieSecret - The secret key used to sign/verify the approval cookie.
 * @returns A promise resolving to true if the client ID is in the list of approved clients in a valid cookie, false otherwise.
 */
export const isClientAlreadyApproved = async (
  req: ExpressRequest,
  clientId: string,
  cookieSecret: string,
) => {
  const approvedClients = await getApprovedClientsFromCookie(
    req.cookies[COOKIE_NAME] ?? '',
    cookieSecret,
  );
  return approvedClients.includes(clientId);
};

/**
 * Updates the approved clients cookie with a new client ID.
 * The cookie is signed using HMAC-SHA256 for integrity.
 *
 * @param request - Express request containing existing cookie
 * @param clientId - Client ID to add to approved list
 * @param cookieSecret - Secret key for signing cookie
 * @returns Cookie string with updated approved clients list
 */
export const updateApprovedClientsCookie = async (
  req: ExpressRequest,
  res: ExpressResponse,
  clientId: string,
  cookieSecret: string,
) => {
  const approvedClients = await getApprovedClientsFromCookie(
    req.cookies[COOKIE_NAME] ?? '',
    cookieSecret,
  );
  const newApprovedClients = JSON.stringify(
    Array.from(new Set([...approvedClients, clientId])),
  );
  const key = await importKey(cookieSecret);
  const signature = await signData(key, newApprovedClients);
  res.cookie(COOKIE_NAME, `${signature}.${btoa(newApprovedClients)}`, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: ONE_YEAR_IN_SECONDS,
    path: '/',
  });
};
