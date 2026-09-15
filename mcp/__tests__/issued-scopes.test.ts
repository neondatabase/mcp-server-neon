import { describe, expect, it } from 'vitest';
import { issuedOauthScopes, oauthWriteAllowed } from '../oauth/issued-scopes';

describe('issuedOauthScopes', () => {
  it('defaults omitted scopes to read write when write is granted', () => {
    expect(oauthWriteAllowed([])).toBe(true);
    expect(
      issuedOauthScopes({ requestedScopes: [], grantWrite: true }),
    ).toEqual(['read', 'write']);
  });

  it('issues read only when write is not granted', () => {
    expect(
      issuedOauthScopes({
        requestedScopes: ['read', 'write', '*'],
        grantWrite: false,
      }),
    ).toEqual(['read']);
  });

  it('keeps * only with a granted write', () => {
    expect(
      issuedOauthScopes({
        requestedScopes: ['write', '*'],
        grantWrite: true,
      }),
    ).toEqual(['read', 'write', '*']);
  });
});
