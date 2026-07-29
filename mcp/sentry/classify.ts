/**
 * Decides what Sentry should do with an error. Pure — types only from Sentry, no
 * client and no I/O — so the policy is unit-testable and a change to it fails a test
 * instead of quietly changing what reaches the inbox.
 *
 * This replaces Sentry's `ignoreErrors`, which could only match error *text*. That
 * coupling broke silently: when the server moved from Axios to `@neon/sdk`, every
 * transport fault gained a wrapper whose message was a fixed sentence, so patterns
 * like `/ECONNRESET/` stopped matching and six days of noise came back unnoticed.
 * `ignoreErrors` also only ever tests the outermost exception in a `cause` chain, so
 * the real reason was never visible to it.
 *
 * Two rules follow from that:
 *
 * 1. Branch on structured fields (`kind`, `reason`) for errors we own, never on wording.
 * 2. Group and downgrade rather than drop. A dropped event cannot tell you it was
 *    dropped, which is how a real API bug hid inside "transient network noise" for a
 *    week. Grouping keeps the count and makes an unfamiliar cause open a new issue.
 */

import type { ErrorEvent, EventHint } from '@sentry/node';

/** What Sentry should do with one error. Internal to this module's policy. */
type Disposition = {
  /** Send the event at all. `false` discards it. */
  report: boolean;
  /** Lower the event level when reporting. */
  level?: 'warning';
  /** Collapse related events into a single issue. */
  fingerprint?: string[];
  /** Which rule fired. Asserted in tests and stable enough to search on. */
  rule: string;
};

const DEFAULT: Disposition = { report: true, rule: 'default' };

type NeonErrorLike = Error & { kind: string };

/**
 * Structural rather than `instanceof NeonNetworkError`. Two copies of `@neon/sdk` in
 * one dependency tree make `instanceof` return false, and it would fail by falling
 * through to {@link DEFAULT} — silently disabling the rule.
 */
function asNeonError(error: unknown): NeonErrorLike | undefined {
  if (!(error instanceof Error)) return undefined;
  const kind = (error as Partial<NeonErrorLike>).kind;
  return typeof kind === 'string' ? (error as NeonErrorLike) : undefined;
}

function readReason(error: Error): string {
  const reason = (error as { reason?: unknown }).reason;
  return typeof reason === 'string' && reason.length > 0
    ? reason
    : 'unspecified';
}

/**
 * Errors raised outside our code, where there is no structured field to read. Every
 * entry is a guess about how another library phrases a fault, so this list is fragile
 * by nature — keep it short, and prefer a structural rule whenever one is possible.
 */
const UNOWNED: ReadonlyArray<{
  pattern: RegExp;
  rule: string;
  report: boolean;
}> = [
  // The only rule that discards, and the only one the previous `ignoreErrors` list
  // also discarded. Node raises a bare `aborted` when the peer goes away mid-request.
  { pattern: /^aborted$/i, rule: 'client-disconnect:aborted', report: false },

  // A write to a socket the peer already closed. Almost always a client hanging up
  // mid-stream, but this was never filtered before and it arrives at `fatal` level,
  // so it is grouped rather than dropped — a refactor of the noise policy is the
  // wrong place to make several thousand `fatal` events disappear.
  { pattern: /EPIPE/, rule: 'client-disconnect:epipe', report: true },

  // Transport faults that reach Sentry without an SDK wrapper. Kept visible: these
  // are usually transient, but "usually" is not "always" and the count is the signal.
  { pattern: /ECONNRESET/, rule: 'transport:econnreset', report: true },
  {
    pattern: /socket hang up/i,
    rule: 'transport:socket-hang-up',
    report: true,
  },
  { pattern: /ETIMEDOUT/, rule: 'transport:etimedout', report: true },
  { pattern: /ENOTFOUND/, rule: 'transport:enotfound', report: true },

  // TLS handshake failures.
  {
    pattern: /Client network socket disconnected before secure TLS connection/i,
    rule: 'tls:client-disconnect',
    report: true,
  },
  { pattern: /EPROTO/, rule: 'tls:eproto', report: true },
  {
    pattern: /tlsv1 alert decrypt error/i,
    rule: 'tls:alert-decrypt',
    report: true,
  },
  {
    pattern: /SSL routines.*ssl3_read_bytes/i,
    rule: 'tls:ssl3-read-bytes',
    report: true,
  },
  { pattern: /SSL alert number 51/i, rule: 'tls:alert-51', report: true },

  // A stale serverless Postgres connection, from the driver rather than the SDK.
  {
    pattern: /Connection terminated unexpectedly/i,
    rule: 'postgres:connection-terminated',
    report: true,
  },
];

export function classify(error: unknown): Disposition {
  const neonError = asNeonError(error);

  if (neonError?.kind === 'network') {
    const reason = readReason(neonError);
    return {
      report: true,
      level: 'warning',
      fingerprint: ['neon-transport', reason],
      rule: `neon-transport:${reason}`,
    };
  }

  // Any other Neon error is a real API or caller failure. Report it as-is.
  if (neonError) return DEFAULT;

  if (error instanceof Error && error.message) {
    for (const { pattern, rule, report } of UNOWNED) {
      if (!pattern.test(error.message)) continue;
      return report
        ? { report: true, level: 'warning', fingerprint: [rule], rule }
        : { report: false, rule };
    }
  }

  return DEFAULT;
}

/**
 * Sentry's `beforeSend` hook. Exported rather than inlined into `init` so the wiring
 * between {@link classify} and the outgoing event is covered by a test — the closure
 * is where a correct policy can still be applied to the wrong field.
 */
export function beforeSend(
  event: ErrorEvent,
  hint: EventHint,
): ErrorEvent | null {
  const disposition = classify(hint.originalException);
  if (!disposition.report) return null;
  if (disposition.level) event.level = disposition.level;
  if (disposition.fingerprint) event.fingerprint = disposition.fingerprint;
  return event;
}
