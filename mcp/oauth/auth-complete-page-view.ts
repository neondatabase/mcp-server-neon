import { createHmac, timingSafeEqual } from 'node:crypto';
import { CLIENT_SECRET } from '../../lib/config';

// Long enough for someone to copy the prompt or open the docs after the page
// loads; short enough that a harvested token stops working soon after.
const PAGE_VIEW_TTL_MS = 60 * 60 * 1000;
// Tolerates clock drift between the instance that served the page and the
// one that receives its beacon.
const CLOCK_SKEW_MS = 60 * 1000;

const TOKEN = /^(\d{13})\.([A-Za-z0-9_-]{43})$/;

function signature(pageViewId: string, issuedAt: number): Buffer {
  return createHmac('sha256', CLIENT_SECRET)
    .update(`auth-complete-page-view:${pageViewId}:${issuedAt}`)
    .digest();
}

/**
 * Proves the server served this page view, so the unauthenticated events
 * endpoint only records actions from pages it issued.
 */
export function signPageView(
  pageViewId: string,
  issuedAt = Date.now(),
): string {
  return `${issuedAt}.${signature(pageViewId, issuedAt).toString('base64url')}`;
}

export function isIssuedPageView(
  pageViewId: string,
  token: string,
  now = Date.now(),
): boolean {
  const match = TOKEN.exec(token);
  if (!match) return false;
  const issuedAt = Number(match[1]);
  if (now - issuedAt > PAGE_VIEW_TTL_MS || issuedAt - now > CLOCK_SKEW_MS) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(match[2]!, 'base64url'),
    signature(pageViewId, issuedAt),
  );
}
