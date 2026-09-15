import { describe, expect, it } from 'vitest';
import {
  consentCanonicalLocation,
  InvalidRequestOriginError,
  requestPublicOrigin,
} from '../oauth/consent-canonical-url';

describe('consentCanonicalLocation', () => {
  it('returns undefined when the request is already on the callback host', () => {
    expect(
      consentCanonicalLocation(
        'https://mcp.neon.tech',
        '/api/authorize?client_id=abc',
        'https://mcp.neon.tech',
      ),
    ).toBeUndefined();
  });

  it('rewrites an alternate host onto SERVER_HOST without dropping the query', () => {
    expect(
      consentCanonicalLocation(
        'https://preview.example',
        '/api/authorize?client_id=abc&state=one',
        'https://mcp.neon.tech',
      ),
    ).toBe('https://mcp.neon.tech/api/authorize?client_id=abc&state=one');
  });

  it('treats localhost ports as different hosts', () => {
    expect(
      consentCanonicalLocation(
        'http://127.0.0.1:3100',
        '/api/authorize?x=1',
        'http://localhost:3100',
      ),
    ).toBe('http://localhost:3100/api/authorize?x=1');
  });

  it('classifies a malformed request origin as invalid input', () => {
    expect(() =>
      consentCanonicalLocation(
        'https://[',
        '/api/authorize?client_id=abc',
        'https://mcp.neon.tech',
      ),
    ).toThrow(InvalidRequestOriginError);
  });

  it('keeps malformed SERVER_HOST as a configuration error', () => {
    expect(() =>
      consentCanonicalLocation(
        'https://mcp.neon.tech',
        '/api/authorize?client_id=abc',
        'https://[',
      ),
    ).toThrow(TypeError);
  });
});

describe('requestPublicOrigin', () => {
  it('prefers the Host header over nextUrl.origin', () => {
    expect(
      requestPublicOrigin({
        nextUrl: { protocol: 'http:', origin: 'http://localhost:3100' },
        headers: {
          get: (name) => (name === 'host' ? '127.0.0.1:3100' : null),
        },
      }),
    ).toBe('http://127.0.0.1:3100');
  });

  it('prefers x-forwarded-host when present', () => {
    expect(
      requestPublicOrigin({
        nextUrl: { protocol: 'http:', origin: 'http://localhost:3000' },
        headers: {
          get: (name) => {
            if (name === 'x-forwarded-host') return 'preview.example';
            if (name === 'x-forwarded-proto') return 'https';
            return null;
          },
        },
      }),
    ).toBe('https://preview.example');
  });
});
