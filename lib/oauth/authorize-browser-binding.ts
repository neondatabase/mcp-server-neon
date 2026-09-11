import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

const AUTHORIZE_BROWSER_COOKIE_PREFIX = '__Host-neon_oauth_';
const AUTHORIZE_BROWSER_COOKIE_TTL_SECONDS = 30 * 60;

export function createAuthorizeBrowserBindingId(): string {
  return randomBytes(18).toString('base64url');
}

export function authorizeBrowserCookieName(browserBindingId: string): string {
  return `${AUTHORIZE_BROWSER_COOKIE_PREFIX}${browserBindingId}`;
}

export function hasAuthorizeBrowserBinding(
  request: NextRequest,
  browserBindingId: string,
): boolean {
  return request.cookies.has(authorizeBrowserCookieName(browserBindingId));
}

export function setAuthorizeBrowserBinding(
  response: NextResponse,
  browserBindingId: string,
): void {
  response.cookies.set(authorizeBrowserCookieName(browserBindingId), '1', {
    httpOnly: true,
    maxAge: AUTHORIZE_BROWSER_COOKIE_TTL_SECONDS,
    path: '/',
    sameSite: 'lax',
    secure: true,
  });
}
