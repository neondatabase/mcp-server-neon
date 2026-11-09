import { waitUntil } from '@vercel/functions';
import { NextRequest, NextResponse } from 'next/server';
import { flushAnalytics, track } from '../../../../mcp/analytics/analytics';
import {
  AUTH_COMPLETE_ACTIONS,
  type AuthCompleteAction,
} from '../../../../mcp/oauth/auth-complete-page';
import { isIssuedPageView } from '../../../../mcp/oauth/auth-complete-page-view';
import { requestPublicOrigin } from '../../../../mcp/oauth/consent-canonical-url';

const MAX_BODY_BYTES = 256;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isAction(value: unknown): value is AuthCompleteAction {
  return AUTH_COMPLETE_ACTIONS.includes(value as AuthCompleteAction);
}

/**
 * Reads at most `limit` bytes, whatever Content-Length says or whether it is
 * sent at all. Undefined when the body is longer.
 */
async function readBody(
  request: NextRequest,
  limit: number,
): Promise<string | undefined> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Action beacons from the auth completion page. The page holds no identity,
 * only the page view id that joins these events to its auth_complete_viewed
 * event, and the server's signature for it, so forged ids are rejected.
 */
export async function POST(request: NextRequest) {
  // Firefox sends `Origin: null` under the page's no-referrer policy, so the
  // browser's own Sec-Fetch-Site also counts as proof of a same-origin page.
  const sameOrigin =
    request.headers.get('origin') === requestPublicOrigin(request) ||
    request.headers.get('sec-fetch-site') === 'same-origin';
  if (!sameOrigin) {
    return new NextResponse(null, { status: 403 });
  }

  const body = await readBody(request, MAX_BODY_BYTES);
  if (body === undefined) {
    return new NextResponse(null, { status: 413 });
  }
  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (typeof event !== 'object' || event === null) {
    return new NextResponse(null, { status: 400 });
  }
  const { pageViewId, token, action } = event as Record<string, unknown>;
  if (
    typeof pageViewId !== 'string' ||
    !UUID.test(pageViewId) ||
    typeof token !== 'string' ||
    !isAction(action)
  ) {
    return new NextResponse(null, { status: 400 });
  }
  if (!isIssuedPageView(pageViewId, token)) {
    return new NextResponse(null, { status: 403 });
  }

  track({
    anonymousId: pageViewId,
    event: 'auth_complete_action',
    properties: { pageViewId, action },
  });
  waitUntil(flushAnalytics());
  return new NextResponse(null, { status: 204 });
}
