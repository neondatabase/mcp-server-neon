/**
 * Decoding helpers for raw HTTP response bodies.
 *
 * The telemetry read API is reached through the console's edge, so a request can
 * come back as an HTML page (gateway 502/504, WAF block, auth redirect) even though
 * every successful response is JSON. Handing such a body to `response.json()`
 * produces `SyntaxError: Unexpected token '<'`, which throws away the status code
 * that says whose fault the failure is — see Sentry issue MCP-SERVER-GT.
 */

type JsonBody<T> = { ok: true; value: T } | { ok: false };

/**
 * Parse a body as JSON, reporting failure instead of throwing.
 *
 * Content-Type is deliberately not consulted: gateways label HTML as
 * `application/json` and proxies label JSON as `text/plain`, so the bytes are the
 * only trustworthy signal. Callers use the header for diagnostics only.
 */
export function parseJsonBody<T>(text: string): JsonBody<T> {
  if (text.trim() === '') {
    return { ok: false };
  }
  try {
    const value: T = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

const BODY_SNIPPET_MAX_LENGTH = 200;

/**
 * Single-line, length-capped view of a body for error messages.
 *
 * Whitespace is collapsed so a pretty-printed HTML page cannot flood the message,
 * and the cap keeps unbounded upstream output out of our error strings and Sentry
 * issue titles (which is what makes these failures group usefully).
 */
export function summarizeBody(
  text: string,
  maxLength: number = BODY_SNIPPET_MAX_LENGTH,
): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed === '') {
    return '<empty body>';
  }
  if (collapsed.length <= maxLength) {
    return collapsed;
  }
  return `${collapsed.slice(0, maxLength)}…`;
}
