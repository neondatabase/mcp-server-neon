import { describe, expect, it } from 'vitest';
import { summarizeRequestBody } from '../../lib/oauth/client';

describe('summarizeRequestBody', () => {
  // Regression: PR #252 shipped this summarizer but the customFetch hook
  // in production receives a URLSearchParams body from oauth4webapi, not a
  // serialized string. The original `typeof body !== 'string'` short-circuit
  // returned null in production, so every cliff_upstream log was missing
  // the `upstreamRequest` field we shipped the PR to surface. This file
  // pins the contract for both body shapes so the regression can't return.

  describe('URLSearchParams body (production path)', () => {
    it('summarizes a Cursor-shaped refresh request', () => {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: 'vrx1_CQR2eN3kL9hSx7ZqP8mYwT4uA6BdEfGhIjKlMnOpQrStUv',
        client_id: 'abc123XY',
      });
      expect(summarizeRequestBody(body)).toEqual({
        paramNames: ['client_id', 'grant_type', 'refresh_token'],
        bodyByteLength: body.toString().length,
        refreshTokenFingerprint: 'len=51,prefix=vrx1_C',
        hasClientSecret: false,
        hasDuplicateParams: false,
      });
    });

    it('flags client_secret presence (confidential client)', () => {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: 'tok-XYZ12345',
        client_id: 'app123',
        client_secret: 'secret-value',
      });
      const summary = summarizeRequestBody(body);
      expect(summary?.hasClientSecret).toBe(true);
      expect(summary?.paramNames).toEqual([
        'client_id',
        'client_secret',
        'grant_type',
        'refresh_token',
      ]);
    });

    it('flags duplicate parameter names', () => {
      const body = new URLSearchParams();
      body.append('grant_type', 'refresh_token');
      body.append('refresh_token', 'first');
      body.append('refresh_token', 'second');
      body.append('client_id', 'app');
      const summary = summarizeRequestBody(body);
      expect(summary?.hasDuplicateParams).toBe(true);
    });

    it('omits refreshTokenFingerprint when refresh_token is absent', () => {
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: 'svc',
      });
      const summary = summarizeRequestBody(body);
      expect(summary?.refreshTokenFingerprint).toBeUndefined();
    });
  });

  describe('string body (test/fallback path)', () => {
    it('summarizes an already-serialized form body', () => {
      const body =
        'grant_type=refresh_token&refresh_token=abc12345&client_id=x';
      expect(summarizeRequestBody(body)).toEqual({
        paramNames: ['client_id', 'grant_type', 'refresh_token'],
        bodyByteLength: body.length,
        refreshTokenFingerprint: 'len=8,prefix=abc123',
        hasClientSecret: false,
        hasDuplicateParams: false,
      });
    });
  });

  describe('unsupported body shapes', () => {
    it('returns null for undefined', () => {
      expect(summarizeRequestBody(undefined)).toBeNull();
    });

    it('returns null for null', () => {
      expect(summarizeRequestBody(null)).toBeNull();
    });

    it('returns null for a Buffer', () => {
      // Buffers are valid BodyInit but never used on the token endpoint;
      // bail out rather than emitting a garbage summary.
      expect(summarizeRequestBody(Buffer.from('grant_type=x'))).toBeNull();
    });
  });

  describe('privacy', () => {
    it('never includes the refresh_token value in the summary', () => {
      const sensitive = 'super-secret-refresh-token-value-do-not-leak';
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: sensitive,
      });
      const summary = summarizeRequestBody(body);
      // Stringify so we catch the value if it lands anywhere in the object.
      expect(JSON.stringify(summary)).not.toContain('super-secret');
      expect(JSON.stringify(summary)).not.toContain(sensitive);
    });
  });
});
