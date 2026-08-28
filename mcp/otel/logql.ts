/**
 * Renders the LogQL expression a set of structured filters stands for.
 *
 * `query_logs` reports this expression as `logql` and the compatibility
 * `query` field, so the caller can widen or narrow it and hand it back. The
 * expression is also the fallback for minimum severity, whose structured API
 * filter is not supported consistently across branch backends.
 *
 * The API accepts only a subset of LogQL (Grafana Loki's query language): a
 * stream selector `{label op "value"}` (ops `=`, `!=`, `=~`, `!~`) optionally
 * followed by line filters (`|=`, `!=`, `|~`, `!~`) on the log body. Aggregations,
 * parsers, and formatting stages are rejected.
 */

import { severityAtOrAbovePattern, type SeverityLevel } from './severity';

/** A label matcher operator in a LogQL stream selector. */
type MatchOp = '=' | '!=' | '=~' | '!~';

/**
 * Structured inputs for a logs query. Each field maps to a stream-selector matcher
 * (or a line filter, for `bodyContains`). Only `entityType` has a default; everything
 * else is optional. This is the set of filters the query_logs tool exposes; more
 * exotic filtering is available via the tool's raw-LogQL escape hatch.
 */
type LogQLFilters = {
  /** Producer of the telemetry, e.g. "function" or "storage". */
  entityType?: string;
  serviceName?: string;
  /** Exact severity_text match (e.g. "ERROR"). Takes precedence over minSeverity. */
  severityText?: string;
  /** Minimum OTel severity level; expands to a severity_text regex. */
  minSeverity?: SeverityLevel;
  traceId?: string;
  /** Case-sensitive substring the log body must contain (LogQL `|=`). */
  bodyContains?: string;
};

/** Escape a value for a LogQL double-quoted string literal (Go-unquote compatible). */
function quote(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

/**
 * Build a LogQL expression from structured filters.
 *
 * The stream selector must have at least one matcher (the backend rejects `{}`); an
 * `entityType` (defaulting to "function") guarantees that. Throws if, after applying
 * an explicit empty `entityType`, no selector matcher remains.
 */
export function buildLogQL(filters: LogQLFilters): string {
  const matchers: string[] = [];

  const addMatcher = (label: string, op: MatchOp, value: string) => {
    matchers.push(`${label}${op}${quote(value)}`);
  };

  const entityType = filters.entityType ?? 'function';
  if (entityType) {
    addMatcher('entity_type', '=', entityType);
  }
  if (filters.serviceName) addMatcher('service_name', '=', filters.serviceName);
  if (filters.traceId) addMatcher('trace_id', '=', filters.traceId);

  // Severity precedence lives here (not in the caller): an exact severityText wins
  // over the minSeverity threshold regex.
  if (filters.severityText) {
    addMatcher('severity_text', '=', filters.severityText);
  } else if (filters.minSeverity) {
    addMatcher(
      'severity_text',
      '=~',
      severityAtOrAbovePattern(filters.minSeverity),
    );
  }

  if (matchers.length === 0) {
    throw new Error(
      'A logs query needs at least one stream-selector filter (e.g. entityType, serviceName, or severity).',
    );
  }

  let expr = `{${matchers.join(', ')}}`;

  if (filters.bodyContains) expr += ` |= ${quote(filters.bodyContains)}`;

  return expr;
}
