import { describe, expect, it } from 'vitest';
import {
  AUTH_TRANSACTION_TTL_MS,
  consentCookieMaxAgeSeconds,
  consentCookieSetOptions,
  cookieSecureForRequest,
} from '../oauth/browser-binding';

describe('browser binding cookies', () => {
  it('sets Max-Age to the remaining transaction lifetime', () => {
    const expiresAt = new Date(1_700_000_000_000 + AUTH_TRANSACTION_TTL_MS);
    const options = consentCookieSetOptions(true, expiresAt);
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
    expect(options.path).toBe('/');
    expect(options.secure).toBe(true);
    expect(consentCookieMaxAgeSeconds(expiresAt, 1_700_000_000_000)).toBe(
      AUTH_TRANSACTION_TTL_MS / 1000,
    );
    expect(consentCookieMaxAgeSeconds(expiresAt, expiresAt.getTime() + 1)).toBe(
      0,
    );
  });

  it('marks Secure from https or the forwarded proto', () => {
    expect(
      cookieSecureForRequest({
        nextUrl: { protocol: 'http:' },
        headers: { get: () => null },
      }),
    ).toBe(false);
    expect(
      cookieSecureForRequest({
        nextUrl: { protocol: 'https:' },
        headers: { get: () => null },
      }),
    ).toBe(true);
    expect(
      cookieSecureForRequest({
        nextUrl: { protocol: 'http:' },
        headers: {
          get: (name) => (name === 'x-forwarded-proto' ? 'https' : null),
        },
      }),
    ).toBe(true);
  });
});
