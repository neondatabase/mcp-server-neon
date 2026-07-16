/**
 * Transforms the Loki `streams` envelope into a flat, token-efficient result for
 * the LLM: one record per log line with an ISO-8601 UTC timestamp and the
 * stream labels denormalized onto each record.
 */

import type { LogRecord, LokiQueryResponse } from './types';

/** Convert a unix-nanoseconds string to an ISO-8601 UTC timestamp. */
function nanoStrToIso(ns: string): string {
  // Drop the last 6 digits (nanos → millis) via string slicing to avoid float
  // precision loss on large integers; Date only needs milliseconds.
  const digits = ns.replace(/[^0-9]/g, '');
  const ms = digits.length > 6 ? Number(digits.slice(0, -6)) : 0;
  return new Date(ms).toISOString();
}

type FlattenedLogs = {
  records: LogRecord[];
  /** True when the backend capped the result at the row limit (partial window). */
  truncated: boolean;
  /** The backend's truncation warnings, if any. */
  warnings: string[];
};

/**
 * Flatten a Loki query response into records sorted newest-first. Stream labels
 * (service_name, severity_text, scope_name, entity_type) are lifted onto each
 * record; the log line becomes `body`.
 */
export function flattenLokiResponse(
  response: LokiQueryResponse,
  limit: number,
): FlattenedLogs {
  const records: LogRecord[] = [];

  for (const stream of response.data.result) {
    const labels = stream.stream ?? {};
    for (const [ns, body] of stream.values) {
      records.push({
        timestamp: nanoStrToIso(ns),
        severity: labels.severity_text,
        serviceName: labels.service_name,
        scopeName: labels.scope_name,
        entityType: labels.entity_type,
        body,
      });
    }
  }

  // The backend groups by stream then orders within each; flatten and re-sort so the
  // merged result is globally newest-first.
  records.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const warnings = response.warnings ?? [];
  return {
    records: records.slice(0, limit),
    truncated: warnings.length > 0,
    warnings,
  };
}
