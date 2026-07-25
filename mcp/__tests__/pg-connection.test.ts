/**
 * Unit tests for Postgres connection-string normalization.
 *
 * The risk here is not a missed rewrite but a mangled connection string, so most
 * of these pin what must stay untouched. The end-to-end effect (pg no longer
 * emitting its SSL warning) is covered in pg-ssl-warning.integration.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { pinSslVerificationMode } from '../utils/pg-connection';

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

describe('pinSslVerificationMode', () => {
  it('pins the aliased modes to verify-full', () => {
    for (const mode of ['prefer', 'require', 'verify-ca']) {
      expect(pinSslVerificationMode(url(`sslmode=${mode}`))).toBe(
        url('sslmode=verify-full'),
      );
    }
  });

  it('leaves a connection string that already asks for verify-full alone', () => {
    const alreadyPinned = url('sslmode=verify-full');

    expect(pinSslVerificationMode(alreadyPinned)).toBe(alreadyPinned);
  });

  it('leaves modes that carry no alias alone', () => {
    // 'disable' and 'no-verify' mean the same thing under both the current and
    // the libpq semantics, so there is nothing to pin.
    for (const mode of ['disable', 'no-verify']) {
      const unaliased = url(`sslmode=${mode}`);
      expect(pinSslVerificationMode(unaliased)).toBe(unaliased);
    }
  });

  it('respects an explicit libpq-compatibility opt-in', () => {
    // Opting into libpq semantics is a deliberate choice about verification
    // strength; overriding it would silently re-strengthen the connection.
    const optedIn = url('uselibpqcompat=true&sslmode=require');

    expect(pinSslVerificationMode(optedIn)).toBe(optedIn);
  });

  it('preserves other parameters and their order', () => {
    expect(
      pinSslVerificationMode(
        url('application_name=mcp&sslmode=require&connect_timeout=10'),
      ),
    ).toBe(url('application_name=mcp&sslmode=verify-full&connect_timeout=10'));
  });

  it('leaves an encoded password byte-for-byte intact', () => {
    // A URL round-trip would re-encode these; a live credential must not change.
    const encoded = { credentials: 'user:p%40ss%2Fw%3Ard%21' };

    expect(pinSslVerificationMode(url('sslmode=require', encoded))).toBe(
      url('sslmode=verify-full', encoded),
    );
  });

  it('handles a Neon-style URL with pooler host and channel binding', () => {
    const neon = {
      scheme: 'postgresql',
      host: 'ep-cool-name-123456-pooler.us-east-2.aws.neon.tech',
      database: 'neondb',
    };

    expect(
      pinSslVerificationMode(
        url('sslmode=require&channel_binding=require', neon),
      ),
    ).toBe(url('sslmode=verify-full&channel_binding=require', neon));
  });

  it('does not mistake another parameter ending in sslmode', () => {
    const lookalike = url('xsslmode=require');

    expect(pinSslVerificationMode(lookalike)).toBe(lookalike);
  });

  it('decides on the last sslmode when the key repeats', () => {
    // pg assigns parameters as it iterates, so the last occurrence wins.
    expect(pinSslVerificationMode(url('sslmode=disable&sslmode=require'))).toBe(
      url('sslmode=verify-full&sslmode=verify-full'),
    );

    const disablesLast = url('sslmode=require&sslmode=disable');
    expect(pinSslVerificationMode(disablesLast)).toBe(disablesLast);
  });

  it('leaves strings without a query alone', () => {
    const noQuery = url('');

    expect(pinSslVerificationMode(noQuery)).toBe(noQuery);
  });

  it('leaves a keyword/value DSN alone', () => {
    // Not a URL; rewriting it by query-string rules would corrupt it.
    const dsn = 'host=host.example port=5432 dbname=db sslmode=require';

    expect(pinSslVerificationMode(dsn)).toBe(dsn);
  });

  it('passes undefined through so pg keeps its own default', () => {
    expect(pinSslVerificationMode(undefined)).toBeUndefined();
  });

  it('passes an empty string through', () => {
    expect(pinSslVerificationMode('')).toBe('');
  });
});
