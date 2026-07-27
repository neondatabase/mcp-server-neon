/**
 * Startup validation for the OAuth store's Postgres SSL mode.
 *
 * `OAUTH_DATABASE_URL` must name `verify-full` explicitly. This only checks that;
 * it never rewrites the connection string. Pinning the mode belongs in the
 * environment variable, where it is set once per deployment and visible to whoever
 * set it, rather than in code that has to do surgery around a live credential.
 */

/**
 * Modes `pg-connection-string` currently treats as aliases for `verify-full`, and
 * warns about on first parse:
 *
 *   SECURITY WARNING: The SSL modes 'prefer', 'require', and 'verify-ca' are
 *   treated as aliases for 'verify-full'. In the next major version
 *   (pg-connection-string v3.0.0 and pg v9.0.0), these modes will adopt standard
 *   libpq semantics, which have weaker security guarantees.
 */
const ALIASED_SSL_MODES: ReadonlySet<string> = new Set([
  'prefer',
  'require',
  'verify-ca',
]);

const REQUIRED_SSL_MODE = 'verify-full';

/**
 * Throw when the OAuth store's connection string asks for an SSL mode that is
 * about to change meaning.
 *
 * The three aliased modes resolve to full certificate and hostname verification
 * today, but adopt libpq semantics in pg v9 — where `require` encrypts without
 * verifying anything. A copy-pasted Neon connection string (the console hands out
 * `?sslmode=require`) would therefore keep working, silently lose verification at
 * the next major bump, and meanwhile emit a warning that Vercel records at error
 * level. Failing here makes that a deploy-time error instead.
 *
 * Deliberately narrow. Only the ambiguous modes are rejected:
 *
 * - `disable` and `no-verify` mean the same thing before and after the semantics
 *   change, so they are unambiguous choices rather than accidents.
 * - An explicit `uselibpqcompat` is an opt-in to the new semantics, i.e. someone
 *   has already made this decision on purpose.
 * - A missing `sslmode`, a keyword/value DSN, or an absent variable are left to
 *   fail on their own terms; turning them into an SSL error would mislead.
 */
export function assertSslVerificationMode(
  connectionString: string | undefined,
): void {
  if (!connectionString) {
    return;
  }

  const queryStart = connectionString.indexOf('?');
  if (queryStart === -1) {
    return;
  }

  const params = new URLSearchParams(connectionString.slice(queryStart + 1));

  if (params.has('uselibpqcompat')) {
    return;
  }

  // pg assigns each parameter as it iterates, so a repeated key resolves to its
  // last occurrence. Judge that same value.
  const modes = params.getAll('sslmode');
  const effectiveMode = modes[modes.length - 1];
  if (effectiveMode === undefined || !ALIASED_SSL_MODES.has(effectiveMode)) {
    return;
  }

  throw new Error(
    `OAUTH_DATABASE_URL uses sslmode=${effectiveMode}, which pg v9 will reinterpret ` +
      `as encryption without verification. Set sslmode=${REQUIRED_SSL_MODE} on the ` +
      `variable instead — Neon's console hands out sslmode=require, so this needs ` +
      `changing by hand. See the "sslmode requirement" section in README.md.`,
  );
}
