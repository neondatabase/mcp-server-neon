import { describe, expect, it } from 'vitest';
import { normalizeRedirectUris } from '../../lib/oauth/redirect-uri';

describe('normalizeRedirectUris', () => {
  it('wraps a scalar redirect URI', () => {
    expect(normalizeRedirectUris('claude://claude.ai/oauth/callback')).toEqual([
      'claude://claude.ai/oauth/callback',
    ]);
  });

  it('keeps an existing string array unchanged', () => {
    const redirectUris = [
      'http://hermes.cobaltweb.dev/callback',
      'https://client.example/callback',
    ];
    expect(normalizeRedirectUris(redirectUris)).toEqual(redirectUris);
  });

  it('drops non-string entries without dropping valid redirects', () => {
    expect(
      normalizeRedirectUris(['https://client.example/callback', 42, null]),
    ).toEqual(['https://client.example/callback']);
  });

  it('rejects values with no usable redirect string', () => {
    expect(normalizeRedirectUris(undefined)).toBeUndefined();
    expect(normalizeRedirectUris({})).toBeUndefined();
    expect(normalizeRedirectUris([])).toBeUndefined();
    expect(normalizeRedirectUris([42, null])).toBeUndefined();
  });
});
