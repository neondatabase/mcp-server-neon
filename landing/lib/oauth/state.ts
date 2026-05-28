/**
 * HMAC-signed envelope for the OAuth authorize state that travels through
 * the user's browser between `GET /api/authorize` and the consent
 * Server Action at `app/oauth/consent/actions.ts`.
 *
 * Why this exists:
 *   Before the consent page migration, the parsed authorize request
 *   round-tripped as a plain `btoa(JSON.stringify(...))` blob in a hidden
 *   form field and the POST handler re-read it without verifying
 *   integrity. A user could edit that hidden field and inject an
 *   attacker-controlled `redirectUri` or `clientId` which the server
 *   would then re-encode and forward verbatim to the upstream OAuth
 *   provider. Signing the envelope with `COOKIE_SECRET` lets the
 *   Server Action trust the payload and reject tampered submissions
 *   before any side effect.
 *
 * Format:
 *   `<hexSignature>.<base64UrlPayload>`
 *
 *   - Payload is JSON-encoded then base64url-encoded (URL-safe; no padding
 *     concerns when reflected as a hidden form value).
 *   - Signature is HMAC-SHA256 over the ASCII bytes of the base64url payload
 *     (sign-then-encode would also work; signing the encoded form keeps the
 *     verifier from having to round-trip JSON to compare).
 *   - Signatures are compared via `crypto.subtle.verify` which is naturally
 *     constant-time.
 *
 * The unsigned upstream `state` parameter (sent to Hydra and echoed back to
 * /callback) is still a plain `btoa(JSON.stringify(...))` blob — that
 * shape is part of our wire contract with the upstream and the callback
 * decoder. Only the *form-bound* state is HMAC-signed. The Server Action
 * unwraps the signed envelope, applies user selections, then re-encodes the
 * payload with the same legacy base64 shape for upstream.
 */

const SEPARATOR = '.';

let cachedKey: { secret: string; key: Promise<CryptoKey> } | null = null;

const importKey = (secret: string): Promise<CryptoKey> => {
  if (cachedKey && cachedKey.secret === secret) {
    return cachedKey.key;
  }
  const enc = new TextEncoder();
  const key = crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  cachedKey = { secret, key };
  return key;
};

const bytesToHex = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
};

const hexToBytes = (hex: string): Uint8Array | null => {
  if (hex.length === 0 || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) return null;
    out[i] = byte;
  }
  return out;
};

// `btoa`/`atob` only accept Latin1 strings, so we go via UTF-8 bytes for
// payloads that may contain non-ASCII characters (rare for OAuth fields,
// but cheaper to handle generically than to validate every input shape).
const toBase64Url = (input: string): string => {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 = btoa(binary);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (input: string): string => {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding =
    padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const binary = atob(padded + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};

/**
 * Sign an arbitrary JSON-serializable payload, returning the
 * `<sig>.<payload>` envelope suitable for round-tripping through a hidden
 * form field.
 */
export const signState = async (
  payload: unknown,
  secret: string,
): Promise<string> => {
  if (!secret) {
    throw new Error('signState: secret is required');
  }
  const json = JSON.stringify(payload);
  const encodedPayload = toBase64Url(json);
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(encodedPayload),
  );
  const sigHex = bytesToHex(new Uint8Array(signature));
  return `${sigHex}${SEPARATOR}${encodedPayload}`;
};

/**
 * Verify a signed envelope and decode the payload as JSON. Returns `null`
 * for any failure (malformed, tampered, or non-JSON payload). Callers MUST
 * treat `null` as a request rejection signal — never fall back to the
 * unsigned payload.
 */
export const verifyAndDecodeState = async <T>(
  signed: string | null | undefined,
  secret: string,
): Promise<T | null> => {
  if (!signed || !secret) return null;

  const sepIdx = signed.indexOf(SEPARATOR);
  if (sepIdx <= 0 || sepIdx === signed.length - 1) {
    return null;
  }

  const sigHex = signed.slice(0, sepIdx);
  const encodedPayload = signed.slice(sepIdx + 1);

  const sigBytes = hexToBytes(sigHex);
  if (!sigBytes) return null;

  let valid: boolean;
  try {
    const key = await importKey(secret);
    valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      new TextEncoder().encode(encodedPayload),
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  try {
    const json = fromBase64Url(encodedPayload);
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
};
