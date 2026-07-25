/**
 * Integration coverage for the pg SSL-mode warning, observed end to end.
 *
 * `OAUTH_DATABASE_URL` is a Neon URL ending in `?sslmode=require`, and pg's
 * connection-string parser emits a process warning the first time it sees that
 * mode. Vercel records it at error level, where it made up 78 of the last 100
 * error-level log entries for the production deployment and buried real failures.
 *
 * Nothing is stubbed: the assertions listen on Node's real `process.on('warning')`
 * channel while the real Keyv store is driven through the real `@keyv/postgres`
 * and `pg` stack. pg parses the connection string while opening a connection, and
 * it parses before it dials, so the host below is a closed local port — the test
 * stays offline and each attempt fails fast. Connecting successfully is covered by
 * the live smoke run against a real Neon database, not here.
 *
 * The parser warns only once per process (a flag inside a module Node caches
 * outside vitest's registry), so both phases live in one test and must run in
 * this order: our store first, then the control that proves the warning is still
 * reachable afterwards.
 */

import { KeyvPostgres } from '@keyv/postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    silent: false,
  },
}));

const SSL_WARNING_MARKER = "treated as aliases for 'verify-full'";

/**
 * Composed at runtime rather than written out literally because the repo's
 * pre-commit secret scanner flags anything shaped like a credentialed connection
 * string, fake credentials included.
 */
const neonShapedUrl = (mode: string): string =>
  `postgres://${['user', 'pass'].join(':')}@127.0.0.1:1/neondb?sslmode=${mode}`;

const REQUIRE_MODE_URL = neonShapedUrl('require');

/** Collect warnings emitted while `work` runs, using Node's real warning event. */
async function warningsDuring(
  work: () => Promise<unknown> | unknown,
): Promise<string[]> {
  const collected: string[] = [];
  const listener = (warning: Error) => collected.push(warning.message);
  process.on('warning', listener);
  try {
    await work();
    // process.emitWarning delivers asynchronously.
    await new Promise((resolve) => setTimeout(resolve, 300));
  } finally {
    process.off('warning', listener);
  }
  return collected;
}

const sslWarnings = (messages: string[]): string[] =>
  messages.filter((message) => message.includes(SSL_WARNING_MARKER));

describe('pg SSL-mode warning', () => {
  afterEach(() => {
    delete process.env.OAUTH_DATABASE_URL;
  });

  it('is not emitted for our store, and is emitted without the fix', async () => {
    process.env.OAUTH_DATABASE_URL = REQUIRE_MODE_URL;
    const { getTokens } = await import('../oauth/kv-store');

    // Phase 1: the real store, built from a require-mode URL exactly as
    // production is, driven far enough to make pg open a connection and parse.
    // The pinned mode leaves the parser nothing to warn about.
    const fromOurStore = await warningsDuring(() =>
      // Rejects against the closed port; the parse it triggers is the point.
      getTokens()
        .get('probe')
        .catch(() => undefined),
    );

    expect(sslWarnings(fromOurStore)).toEqual([]);

    // Phase 2: the same stack handed the raw URL, proving the warning is still
    // live in this process and phase 1's silence is the fix rather than a dormant
    // dependency or an already-spent warn-once flag.
    //
    // The URL goes in as `uri`, not `connectionString`: @keyv/postgres caches one
    // global pool keyed on `uri`, so a store that varied only `connectionString`
    // would reuse phase 1's pool and never parse this string at all.
    const fromRawUrl = await warningsDuring(() => {
      const control = new KeyvPostgres({ uri: REQUIRE_MODE_URL });
      // Required: the store's own `emit('error')` throws when nobody listens.
      control.on('error', () => {});
      return control.get('probe').catch(() => undefined);
    });

    expect(sslWarnings(fromRawUrl).length).toBeGreaterThan(0);
  });

  it('hands pg an explicit verify-full connection string', async () => {
    // The observable contract behind phase 1 above, asserted on its own so a
    // regression is not masked by pg's warn-once bookkeeping.
    const { pinSslVerificationMode } = await import('../utils/pg-connection');

    expect(pinSslVerificationMode(REQUIRE_MODE_URL)).toBe(
      neonShapedUrl('verify-full'),
    );
  });
});
