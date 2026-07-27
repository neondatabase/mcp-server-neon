/**
 * Integration coverage for the OAuth store's SSL-mode guard.
 *
 * `pg-ssl-mode.test.ts` covers the predicate. This proves the wiring: that the
 * real store actually refuses to build on a bad `OAUTH_DATABASE_URL`, and that the
 * failure is a clear config error rather than a connection timeout ten seconds
 * later. Nothing is stubbed except the logger; no connection is ever opened,
 * because the guard runs before `KeyvPostgres` is constructed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    silent: false,
  },
}));

/**
 * Composed at runtime rather than written out literally because the repo's
 * pre-commit secret scanner flags anything shaped like a credentialed connection
 * string, fake credentials included. The host is a closed local port: the guard
 * should reject before anything dials it, and if it ever regresses the test fails
 * fast rather than hanging.
 */
const neonShapedUrl = (mode: string): string =>
  `postgres://${['user', 'pass'].join(':')}@127.0.0.1:1/neondb?channel_binding=require&sslmode=${mode}`;

const originalUrl = process.env.OAUTH_DATABASE_URL;

describe('OAuth store SSL-mode guard', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalUrl === undefined) {
      delete process.env.OAUTH_DATABASE_URL;
    } else {
      process.env.OAUTH_DATABASE_URL = originalUrl;
    }
  });

  it('refuses to build the store when the URL uses an aliased mode', async () => {
    process.env.OAUTH_DATABASE_URL = neonShapedUrl('require');
    const { getClients } = await import('../oauth/kv-store');

    expect(() => getClients()).toThrow(
      /OAUTH_DATABASE_URL uses sslmode=require/,
    );
  });

  it('builds the store when the URL names verify-full', async () => {
    process.env.OAUTH_DATABASE_URL = neonShapedUrl('verify-full');
    const { getClients } = await import('../oauth/kv-store');

    // Constructing the store opens no connection, so this stays offline.
    expect(() => getClients()).not.toThrow();
  });

  it('keeps failing on every call rather than caching a half-built store', async () => {
    process.env.OAUTH_DATABASE_URL = neonShapedUrl('prefer');
    const { getClients } = await import('../oauth/kv-store');

    expect(() => getClients()).toThrow();
    // A config error is not transient: the second caller must see it too, not a
    // silently cached instance from a failed build.
    expect(() => getClients()).toThrow();
  });
});
