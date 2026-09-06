import { afterEach, describe, expect, it } from 'vitest';
import {
  AuthorizeStateConfigError,
  AuthorizeStateError,
  signAuthorizeState,
  verifyAuthorizeState,
} from '../../lib/oauth/authorize-state';

const payload = {
  responseType: 'code',
  clientId: 'client-123',
  redirectUri: 'http://127.0.0.1:55667/callback',
  scope: ['read', 'write'],
  state: 'client-state',
};

describe('authorize state', () => {
  afterEach(() => {
    delete process.env.COOKIE_SECRET;
  });

  it('round-trips a signed envelope', () => {
    process.env.COOKIE_SECRET = 'test-secret';
    const encoded = signAuthorizeState({
      payload,
      maxScope: ['read', 'write'],
    });
    const verified = verifyAuthorizeState(encoded);
    expect(verified.payload).toEqual(payload);
    expect(verified.maxScope).toEqual(['read', 'write']);
  });

  it('rejects a tampered mac', () => {
    process.env.COOKIE_SECRET = 'test-secret';
    const encoded = signAuthorizeState({
      payload,
      maxScope: ['read'],
    });
    const [body, signature] = encoded.split('.');
    const tamperedBody = body.startsWith('A')
      ? `B${body.slice(1)}`
      : `A${body.slice(1)}`;
    expect(() => verifyAuthorizeState(`${tamperedBody}.${signature}`)).toThrow(
      AuthorizeStateError,
    );
  });

  it('rejects unsigned base64 json', () => {
    process.env.COOKIE_SECRET = 'test-secret';
    expect(() => verifyAuthorizeState(btoa(JSON.stringify(payload)))).toThrow(
      'Invalid authorize state. Start the connection again from your MCP client.',
    );
  });

  it('rejects an expired envelope', () => {
    process.env.COOKIE_SECRET = 'test-secret';
    const encoded = signAuthorizeState({
      payload,
      maxScope: ['read'],
      nowSeconds: 1_000,
      ttlSeconds: 10,
    });
    expect(() => verifyAuthorizeState(encoded, 1_011)).toThrow(
      'This authorization request has expired. Start the connection again from your MCP client.',
    );
  });

  it('fails closed when COOKIE_SECRET is missing', () => {
    expect(() => signAuthorizeState({ payload, maxScope: ['read'] })).toThrow(
      AuthorizeStateConfigError,
    );
  });
});
