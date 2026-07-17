/**
 * Shared types for the OpenTelemetry telemetry read layer.
 *
 * Logs is the first signal; the envelope (tenant scope, time window, signal-agnostic
 * client) is intentionally shaped so traces and metrics can be added later without
 * changing the transport.
 */

/** The tenant scope every telemetry query is bound to. */
export type TelemetryScope = {
  projectId: string;
  branchId: string;
};

/**
 * The Loki-compatible response envelope returned by the read API for logs.
 * `resultType` is always "streams" for the LogQL query_range endpoint.
 * See https://grafana.com/docs/loki/latest/reference/loki-http-api/
 */
export type LokiStream = {
  /** The stream's label set (service_name, severity_text, scope_name, entity_type). */
  stream: Record<string, string>;
  /** Ordered [unix_nanoseconds, log_line] pairs. */
  values: [string, string][];
};

export type LokiQueryResponse = {
  status: string;
  /** Present (and non-empty) when the result was capped at the row limit. */
  warnings?: string[];
  data: {
    resultType: string;
    result: LokiStream[];
  };
};

/** The `labels` / `label/{name}/values` scalar response envelope. */
export type LokiScalarResponse = {
  status: string;
  warnings?: string[];
  data: string[];
};

/** A single flattened log record, as returned to the LLM. */
export type LogRecord = {
  /** ISO-8601 UTC timestamp. */
  timestamp: string;
  severity?: string;
  serviceName?: string;
  scopeName?: string;
  entityType?: string;
  body: string;
};
