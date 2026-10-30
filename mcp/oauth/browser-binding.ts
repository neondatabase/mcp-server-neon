import crypto from 'node:crypto';

export const AUTH_TRANSACTION_TTL_MS = 30 * 60 * 1000;
const AUTH_TRANSACTION_ID_PATTERN = /^[0-9a-f]{32}$/;
const COOKIE_PREFIX = 'neon_mcp_at_';

export function createAuthTransactionId(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function isAuthTransactionId(value: string): boolean {
  return AUTH_TRANSACTION_ID_PATTERN.test(value);
}

export function createBrowserSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashBrowserSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

// `__Host-` makes the browser refuse the cookie unless it is Secure, host-only
// and Path=/, so a sibling subdomain cannot plant one. Browsers reject the
// prefix on plain http, which local development uses.
export function consentCookieName(
  transactionId: string,
  secure: boolean,
): string {
  return `${secure ? '__Host-' : ''}${COOKIE_PREFIX}${transactionId}`;
}

// The stored hash covers the cookie name, so a secret replayed under the
// unprefixed name cannot authenticate a transaction created with __Host-.
// Transactions created before the prefix existed hashed the bare secret and
// still complete with their unprefixed cookie until they expire.
export function browserBindingKey(
  secret: string,
  hostPrefixed: boolean,
): string {
  return hostPrefixed ? `__Host-:${secret}` : secret;
}

export function browserBindingFromCookies(
  cookies: { get: (name: string) => { value: string } | undefined },
  transactionId: string,
): string | undefined {
  const prefixed = cookies.get(consentCookieName(transactionId, true))?.value;
  if (prefixed) {
    return browserBindingKey(prefixed, true);
  }
  return cookies.get(consentCookieName(transactionId, false))?.value;
}

export function cookieSecureForRequest(request: {
  nextUrl: { protocol: string };
  headers: { get: (name: string) => string | null };
}): boolean {
  if (request.nextUrl.protocol === 'https:') {
    return true;
  }
  return request.headers.get('x-forwarded-proto') === 'https';
}

export function consentCookieMaxAgeSeconds(
  expiresAt: Date,
  now = Date.now(),
): number {
  return Math.max(0, Math.floor((expiresAt.getTime() - now) / 1000));
}

export function consentCookieSetOptions(
  secure: boolean,
  expiresAt: Date,
): {
  httpOnly: true;
  sameSite: 'lax';
  path: '/';
  secure: boolean;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure,
    maxAge: consentCookieMaxAgeSeconds(expiresAt),
  };
}

export function consentCookieClearOptions(secure: boolean): {
  httpOnly: true;
  sameSite: 'lax';
  path: '/';
  secure: boolean;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure,
    maxAge: 0,
  };
}
