/**
 * OpenTelemetry log severity levels.
 *
 * OTel normalizes severity into a numeric `SeverityNumber` (1-24) grouped into
 * six named ranges, so a threshold like "error and worse" is well-defined across
 * heterogeneous producers. See
 * https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-severitynumber
 *
 * The API takes a minimum severity by name, but the LogQL subset it accepts can only
 * match strings (`=`, `!=`, `=~`, `!~`) — there is no numeric `>=`. So the rendered
 * LogQL equivalent of a minimum-severity filter is a case-insensitive regex over
 * `severity_text` covering the requested level and everything above it.
 */

/** The six OTel severity level names, ordered from least to most severe. */
export const SEVERITY_LEVELS = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
] as const;

export type SeverityLevel = (typeof SEVERITY_LEVELS)[number];

/**
 * Build a LogQL regex value that matches `severity_text` for `min` and every level
 * above it. Case-insensitive, and tolerant of the numbered variants OTel allows
 * (e.g. `ERROR2`) by accepting an optional trailing digit run.
 *
 * The returned value is the raw regex; the caller quotes it into a `severity_text=~`
 * matcher. The backend anchors selector regexes as `^(?:…)$` (matching Loki), so no
 * anchoring is added here.
 */
export function severityAtOrAbovePattern(min: SeverityLevel): string {
  const startIndex = SEVERITY_LEVELS.indexOf(min);
  const names = SEVERITY_LEVELS.slice(startIndex).map((name) =>
    name.toUpperCase(),
  );
  return `(?i)(${names.join('|')})[0-9]*`;
}
