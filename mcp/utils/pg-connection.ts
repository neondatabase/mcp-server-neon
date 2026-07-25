/**
 * Postgres connection-string normalization for the Keyv-backed OAuth store.
 */

/**
 * SSL modes that pg-connection-string currently treats as aliases for
 * `verify-full`, and warns about on first use:
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

const PINNED_SSL_MODE = 'verify-full';

/**
 * Rewrite an aliased `sslmode` to the `verify-full` it already resolves to.
 *
 * Two reasons, in order of importance. First, when pg v9 lands, these modes stop
 * meaning full certificate and hostname verification and silently start meaning
 * libpq's weaker checks; naming the mode we actually want keeps the guarantee we
 * have today. Second, the warning reaches Vercel's logs at error level, where it
 * accounted for 78 of the last 100 error-level entries and buried real failures.
 *
 * Only the `sslmode` value is touched. Credentials and every other parameter are
 * left byte-for-byte intact rather than round-tripped through `URL`, which would
 * re-encode a password for no reason. Inputs this does not understand — keyword
 * DSNs, a missing `sslmode`, an explicit `uselibpqcompat` opt-in, or a mode that
 * carries no alias — are returned unchanged.
 */
export function pinSslVerificationMode(connectionString: string): string;
export function pinSslVerificationMode(connectionString: undefined): undefined;
export function pinSslVerificationMode(
  connectionString: string | undefined,
): string | undefined;
export function pinSslVerificationMode(
  connectionString: string | undefined,
): string | undefined {
  if (connectionString === undefined) {
    return connectionString;
  }

  const queryStart = connectionString.indexOf('?');
  if (queryStart === -1) {
    return connectionString;
  }

  const query = connectionString.slice(queryStart + 1);
  const params = new URLSearchParams(query);

  // An explicit libpq-compatibility opt-in is a deliberate choice about
  // verification strength, so leave it alone.
  if (params.has('uselibpqcompat')) {
    return connectionString;
  }

  // pg assigns each parameter as it iterates, so a repeated key resolves to its
  // last occurrence. Decide on that same value.
  const modes = params.getAll('sslmode');
  const effectiveMode = modes[modes.length - 1];
  if (effectiveMode === undefined || !ALIASED_SSL_MODES.has(effectiveMode)) {
    return connectionString;
  }

  const pinnedQuery = query.replace(
    /(^|&)sslmode=[^&]*/g,
    `$1sslmode=${PINNED_SSL_MODE}`,
  );
  return `${connectionString.slice(0, queryStart + 1)}${pinnedQuery}`;
}
