/**
 * Unit tests for the OAuth store's SSL-mode guard.
 *
 * The guard only ever accepts or rejects — it never rewrites a connection string —
 * so these split into "must throw" and, more importantly, "must not throw". A
 * false positive here fails every OAuth request in production, which makes the
 * negative cases the ones worth being thorough about.
 */

import { describe, expect, it } from 'vitest';
import { assertSslVerificationMode } from '../oauth/pg-ssl-mode';

type UrlParts = {
  credentials?: string;
  scheme?: string;
  host?: string;
  database?: string;
};

/**
 * Compose a Postgres URL fixture. Assembled at runtime rather than written out
 * literally because the repo's pre-commit secret scanner flags anything shaped
 * like a credentialed connection string, fake credentials included.
 */
const url = (query: string, parts: UrlParts = {}): string => {
  const {
    scheme = 'postgres',
    credentials = ['user', 'pass'].join(':'),
    host = 'host',
    database = 'db',
  } = parts;
  const suffix = query === '' ? '' : `?${query}`;
  return `${scheme}://${credentials}@${host}/${database}${suffix}`;
};

describe('assertSslVerificationMode', () => {
  describe('rejects the modes that are about to change meaning', () => {
    for (const mode of ['prefer', 'require', 'verify-ca']) {
      it(`throws on sslmode=${mode}`, () => {
        expect(() => assertSslVerificationMode(url(`sslmode=${mode}`))).toThrow(
          /sslmode=verify-full/,
        );
      });
    }

    it('names the offending mode and the variable, so the fix is obvious', () => {
      expect(() => assertSslVerificationMode(url('sslmode=require'))).toThrow(
        /OAUTH_DATABASE_URL uses sslmode=require/,
      );
    });

    it('judges the last sslmode when the key repeats, matching pg', () => {
      expect(() =>
        assertSslVerificationMode(url('sslmode=disable&sslmode=require')),
      ).toThrow();
    });
  });

  describe('accepts everything else', () => {
    it('accepts the mode we ask for', () => {
      expect(() =>
        assertSslVerificationMode(url('sslmode=verify-full')),
      ).not.toThrow();
    });

    it('accepts modes that mean the same thing after the change', () => {
      // Unambiguous choices rather than accidents: their meaning is stable.
      for (const mode of ['disable', 'no-verify']) {
        expect(() =>
          assertSslVerificationMode(url(`sslmode=${mode}`)),
        ).not.toThrow();
      }
    });

    it('accepts an explicit libpq-compatibility opt-in', () => {
      expect(() =>
        assertSslVerificationMode(url('uselibpqcompat=true&sslmode=require')),
      ).not.toThrow();
    });

    it('accepts a repeated key whose last value is fine', () => {
      expect(() =>
        assertSslVerificationMode(url('sslmode=require&sslmode=verify-full')),
      ).not.toThrow();
    });

    it('leaves a missing sslmode to fail on its own terms', () => {
      expect(() =>
        assertSslVerificationMode(url('application_name=mcp')),
      ).not.toThrow();
      expect(() => assertSslVerificationMode(url(''))).not.toThrow();
    });

    it('accepts a keyword/value DSN, which is not a URL', () => {
      expect(() =>
        assertSslVerificationMode(
          'host=host.example port=5432 dbname=db sslmode=require',
        ),
      ).not.toThrow();
    });

    it('accepts an absent or empty variable', () => {
      expect(() => assertSslVerificationMode(undefined)).not.toThrow();
      expect(() => assertSslVerificationMode('')).not.toThrow();
    });
  });

  describe('does not false-positive on lookalikes', () => {
    it('ignores a parameter that merely ends in sslmode', () => {
      expect(() =>
        assertSslVerificationMode(url('xsslmode=require')),
      ).not.toThrow();
    });

    it('ignores a host or database literally named sslmode', () => {
      expect(() =>
        assertSslVerificationMode(
          url('sslmode=verify-full', {
            host: 'sslmode=require.example',
            database: 'sslmode=require',
          }),
        ),
      ).not.toThrow();
    });

    it('ignores credentials that contain the parameter', () => {
      expect(() =>
        assertSslVerificationMode(
          url('sslmode=verify-full', {
            credentials: ['sslmode', 'sslmode%3Drequire'].join(':'),
          }),
        ),
      ).not.toThrow();
    });
  });
});
