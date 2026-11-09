import { waitUntil } from '@vercel/functions';
import { NextRequest, NextResponse } from 'next/server';
import { flushAnalytics, track } from '../../../../mcp/analytics/analytics';
import {
  AUTH_COMPLETE_ACTIONS,
  type AuthCompleteAction,
} from '../../../../mcp/oauth/auth-complete-page';
import { requestPublicOrigin } from '../../../../mcp/oauth/consent-canonical-url';

const MAX_BODY_BYTES = 256;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isAction(value: unknown): value is AuthCompleteAction {
  return AUTH_COMPLETE_ACTIONS.includes(value as AuthCompleteAction);
}

/**
 * Action beacons from the auth completion page. Unauthenticated by design:
 * the page holds no identity, only the page view id that joins these events
 * to its auth_complete_viewed event.
 */
export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== requestPublicOrigin(request)) {
    return new NextResponse(null, { status: 403 });
  }

  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) {
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
  const { pageViewId, action } = event as Record<string, unknown>;
  if (
    typeof pageViewId !== 'string' ||
    !UUID.test(pageViewId) ||
    !isAction(action)
  ) {
    return new NextResponse(null, { status: 400 });
  }

  track({
    anonymousId: pageViewId,
    event: 'auth_complete_action',
    properties: { pageViewId, action },
  });
  waitUntil(flushAnalytics());
  return new NextResponse(null, { status: 204 });
}
