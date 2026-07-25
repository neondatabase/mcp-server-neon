/**
 * HTTP client for the Neon telemetry read API (OpenTelemetry, logs-first).
 *
 * The read API is Loki-compatible and lives at
 *   {NEON_TELEMETRY_API_HOST}/projects/{projectId}/branches/{branchId}/loki/api/v1/...
 * It is a sibling of /api/v2 and is NOT on the public OpenAPI spec, so it is not a
 * generated method on the Neon SDK. We reuse the client's low-level `request`
 * escape hatch with an absolute URL, which carries the caller's
 * `Authorization: Bearer` credentials unchanged.
 *
 * Only the logs (LogQL) endpoints are wired today; the tenant path and client are
 * signal-agnostic so traces (TraceQL) and metrics (PromQL) can be added later.
 */

import type { Api, RawRequest } from '../neon-client';
import { NEON_TELEMETRY_API_HOST } from '../constants';
import { InvalidArgumentError, NonJsonResponseError } from '../server/errors';
import type {
  LokiQueryResponse,
  LokiScalarResponse,
  TelemetryScope,
} from './types';

/** The Loki protocol prefix under a tenant path — the logs signal. */
const LOKI_PREFIX = 'loki/api/v1';

function tenantBaseUrl(scope: TelemetryScope): string {
  const base = NEON_TELEMETRY_API_HOST.replace(/\/$/, '');
  return `${base}/projects/${encodeURIComponent(scope.projectId)}/branches/${encodeURIComponent(
    scope.branchId,
  )}/${LOKI_PREFIX}`;
}

/**
 * The client's `request` escape hatch resolves on any status when the body is JSON
 * (it does not reject on non-2xx), so a Loki error (`{ status: "error", error: "..." }`
 * with a 4xx/5xx code) resolves with its body intact and we map it here, surfacing
 * the Loki `error` string. This matters because the generic tool-error handler renders
 * `error.response.data.message`, which a Loki body does not have (it uses `error`).
 *
 * A 4xx is the caller's fault (bad LogQL, bad time range) → InvalidArgumentError, a
 * client error kept out of Sentry. A 5xx is a telemetry-backend fault → a plain Error,
 * which handleToolError routes to `captureException` so a backend outage stays visible
 * to on-call.
 */
function assertOk(response: { status: number; data: unknown }): void {
  if (response.status >= 200 && response.status < 300) return;
  const data = response.data as { error?: string } | undefined;
  const message =
    data?.error ?? `Telemetry API returned status ${response.status}`;
  if (response.status >= 500) {
    throw new Error(`Telemetry backend error: ${message}`);
  }
  throw new InvalidArgumentError(message);
}

/**
 * Put an undecodable body on the same fault line assertOk uses.
 *
 * The read API is reached through the console's edge, which answers with an HTML
 * page when it never reaches the backend (gateway 502/504, WAF block, auth
 * redirect). A 4xx page is the caller's problem — a revoked key or a project the
 * key cannot see — so it stays a client error. Anything else is ours: a 5xx page
 * means the backend is unhealthy, and JSON-shaped success that is not JSON at all
 * means the edge is intercepting our traffic. Both need to reach on-call.
 */
function telemetryErrorFromNonJson(error: NonJsonResponseError): Error {
  const detail = `non-JSON response (HTTP ${error.status}, content-type ${
    error.contentType ?? 'unknown'
  }): ${error.bodySnippet}`;
  if (error.status >= 400 && error.status < 500) {
    return new InvalidArgumentError(`Telemetry API returned a ${detail}`);
  }
  return new Error(`Telemetry backend error: ${detail}`);
}

/**
 * Single entry point for telemetry reads, so the error contract (Loki envelopes and
 * undecodable bodies alike) is defined once for every endpoint.
 */
async function telemetryRequest<T>(
  neonClient: Api<unknown>,
  request: RawRequest,
): Promise<T> {
  try {
    const response = await neonClient.request<T>(request);
    assertOk(response);
    return response.data;
  } catch (error) {
    if (error instanceof NonJsonResponseError) {
      throw telemetryErrorFromNonJson(error);
    }
    throw error;
  }
}

type QueryRangeParams = {
  scope: TelemetryScope;
  /** LogQL expression. */
  query: string;
  /** Absolute window bounds — RFC3339 or unix nanoseconds. */
  start?: string;
  end?: string;
  /** Relative lookback (Go duration, e.g. "1h") when start/end are not given. */
  since?: string;
  /** Max log lines. Clamped server-side to the configured max. */
  limit?: number;
  /** "forward" (oldest first) or "backward" (newest first, default). */
  direction?: 'forward' | 'backward';
};

/** Run a LogQL range query. Returns the raw Loki `streams` envelope. */
export async function queryRange(
  neonClient: Api<unknown>,
  params: QueryRangeParams,
): Promise<LokiQueryResponse> {
  const query: Record<string, string | number> = { query: params.query };
  if (params.start) query.start = params.start;
  if (params.end) query.end = params.end;
  if (params.since) query.since = params.since;
  if (params.limit !== undefined) query.limit = params.limit;
  if (params.direction) query.direction = params.direction;

  return telemetryRequest<LokiQueryResponse>(neonClient, {
    path: `${tenantBaseUrl(params.scope)}/query_range`,
    method: 'GET',
    query,
    secure: true,
  });
}

/** Fetch the advertised stream label names (the filterable low-cardinality fields). */
export async function listLabels(
  neonClient: Api<unknown>,
  scope: TelemetryScope,
): Promise<string[]> {
  const body = await telemetryRequest<LokiScalarResponse>(neonClient, {
    path: `${tenantBaseUrl(scope)}/labels`,
    method: 'GET',
    secure: true,
  });
  return body.data;
}

type LabelValuesParams = {
  scope: TelemetryScope;
  label: string;
  since?: string;
};

/** Fetch distinct values of one advertised label within the tenant scope + window. */
export async function listLabelValues(
  neonClient: Api<unknown>,
  params: LabelValuesParams,
): Promise<string[]> {
  const query: Record<string, string> = {};
  if (params.since) query.since = params.since;

  const body = await telemetryRequest<LokiScalarResponse>(neonClient, {
    path: `${tenantBaseUrl(params.scope)}/label/${encodeURIComponent(params.label)}/values`,
    method: 'GET',
    query,
    secure: true,
  });
  return body.data;
}
