import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { isAuthorizePostOriginAllowed } from '../../lib/oauth/authorize-origin';

function postRequest(
  headers: Record<string, string>,
  url = 'http://localhost/api/authorize',
): NextRequest {
  return new NextRequest(url, { method: 'POST', headers });
}

describe('isAuthorizePostOriginAllowed', () => {
  it('accepts Origin matching the request URL', () => {
    expect(
      isAuthorizePostOriginAllowed(postRequest({ origin: 'http://localhost' })),
    ).toBe(true);
  });

  it('accepts Referer when Origin is absent', () => {
    expect(
      isAuthorizePostOriginAllowed(
        postRequest({ referer: 'http://localhost/api/authorize' }),
      ),
    ).toBe(true);
  });

  it('rejects a cross-site Origin', () => {
    expect(
      isAuthorizePostOriginAllowed(
        postRequest({ origin: 'https://evil.example' }),
      ),
    ).toBe(false);
  });

  it('rejects a request with no Origin or Referer', () => {
    expect(isAuthorizePostOriginAllowed(postRequest({}))).toBe(false);
  });

  it('does not trust a spoofed x-forwarded-host', () => {
    expect(
      isAuthorizePostOriginAllowed(
        postRequest({
          origin: 'https://evil.example',
          'x-forwarded-host': 'evil.example',
          'x-forwarded-proto': 'https',
        }),
      ),
    ).toBe(false);
  });
});
