import { NextRequest } from 'next/server';
import { SERVER_HOST } from '../config';

function originFromServerHost(serverHost: string): string | undefined {
  try {
    const trimmed = serverHost.trim();
    const withProtocol = trimmed.includes('://')
      ? trimmed
      : `https://${trimmed}`;
    return new URL(withProtocol).origin;
  } catch {
    return undefined;
  }
}

function presentedOrigin(request: NextRequest): string | undefined {
  const origin = request.headers.get('origin');
  if (origin && origin !== 'null') {
    try {
      return new URL(origin).origin;
    } catch {
      return undefined;
    }
  }
  const referer = request.headers.get('referer');
  if (!referer) {
    return undefined;
  }
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

export function isAuthorizePostOriginAllowed(request: NextRequest): boolean {
  const presented = presentedOrigin(request);
  if (!presented) {
    return false;
  }
  const allowed = new Set<string>();
  const configured = originFromServerHost(SERVER_HOST);
  if (configured) {
    allowed.add(configured);
  }
  allowed.add(request.nextUrl.origin);
  return allowed.has(presented);
}
