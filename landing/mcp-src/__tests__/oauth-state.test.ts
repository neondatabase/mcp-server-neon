import { describe, expect, it } from 'vitest';
import { signState, verifyAndDecodeState } from '../../lib/oauth/state';

const SECRET = 'unit-test-secret-must-be-stable';

describe('oauth/state HMAC envelope', () => {
  it('round-trips an arbitrary JSON-serializable payload', async () => {
    const payload = {
      authRequest: {
        clientId: 'client-1',
        redirectUri: 'http://127.0.0.1:55667/callback',
        scope: ['read', 'write'],
      },
      iat: 123,
    };
    const signed = await signState(payload, SECRET);
    expect(signed).toMatch(/^[0-9a-f]{64}\./);
    const decoded = await verifyAndDecodeState(signed, SECRET);
    expect(decoded).toEqual(payload);
  });

  it('returns null when the signature does not match', async () => {
    const signed = await signState({ value: 1 }, SECRET);
    const tampered = `${'00'.repeat(32)}.${signed.split('.')[1]}`;
    const decoded = await verifyAndDecodeState(tampered, SECRET);
    expect(decoded).toBeNull();
  });

  it('returns null when the payload was edited but the signature reused', async () => {
    const signed = await signState({ value: 'original' }, SECRET);
    const [sig] = signed.split('.');
    const fakePayload = btoa(JSON.stringify({ value: 'tampered' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const tampered = `${sig}.${fakePayload}`;
    const decoded = await verifyAndDecodeState(tampered, SECRET);
    expect(decoded).toBeNull();
  });

  it('returns null when the secret differs', async () => {
    const signed = await signState({ value: 1 }, SECRET);
    const decoded = await verifyAndDecodeState(signed, 'different-secret');
    expect(decoded).toBeNull();
  });

  it('returns null for a malformed envelope', async () => {
    expect(await verifyAndDecodeState('not-an-envelope', SECRET)).toBeNull();
    expect(await verifyAndDecodeState('.onlyrhs', SECRET)).toBeNull();
    expect(await verifyAndDecodeState('onlylhs.', SECRET)).toBeNull();
    expect(await verifyAndDecodeState('', SECRET)).toBeNull();
    expect(await verifyAndDecodeState(null, SECRET)).toBeNull();
    expect(await verifyAndDecodeState(undefined, SECRET)).toBeNull();
  });

  it('refuses to sign with an empty secret', async () => {
    await expect(signState({ value: 1 }, '')).rejects.toThrow(/secret/);
  });

  it('returns null when called with an empty secret', async () => {
    const signed = await signState({ value: 1 }, SECRET);
    expect(await verifyAndDecodeState(signed, '')).toBeNull();
  });

  it('handles unicode payloads correctly through base64url encoding', async () => {
    const payload = {
      name: 'éüñ漢字 🚀',
      authRequest: { clientId: 'клиент-1' },
    };
    const signed = await signState(payload, SECRET);
    expect(await verifyAndDecodeState(signed, SECRET)).toEqual(payload);
  });
});
