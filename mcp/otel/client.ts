/**
 * HTTP client for the Neon telemetry read API (OpenTelemetry, logs-first).
 *
 * The read API is Loki-compatible and lives at
 *   {NEON_TELEMETRY_API_HOST}/projects/{projectId}/branches/{branchId}/loki/api/v1/...
 * It is a sibling of /api/v2 and is NOT on the public OpenAPI spec, so it is not a
 * generated method on the Neon API client. We reuse the client's underlying axios
 * transport (`neonClient.request`) with an absolute URL: axios ignores `baseURL`
 * when the path is absolute, and the client's default `Authorization: Bearer` header
 * carries the caller's Neon credentials unchanged.
 *
 * Only the logs (LogQL) endpoints are wired today; the tenant path and client are
 * signal-agnostic so traces (TraceQL) and metrics (PromQL) can be added later.
 */

import type { Api } from '@neondatabase/api-client';
import { NEON_TELEMETRY_API_HOST } from '../constants';
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
 * Loki errors come back as `{ status: "error", error: "..." }` with a non-2xx code.
 * Axios (validateStatus default) throws on those, so a thrown AxiosError is the
 * error path; we surface the Loki `error` message when present.
 */
function assertOk(response: { status: number; data: unknown }): void {
  if (response.status < 200 || response.status >= 300) {
    const data = response.data as { error?: string } | undefined;
    throw new Error(
      data?.error ?? `Telemetry API returned status ${response.status}`,
    );
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

  const response = await neonClient.request<LokiQueryResponse>({
    path: `${tenantBaseUrl(params.scope)}/query_range`,
    method: 'GET',
    query,
    secure: true,
  });
  assertOk(response);
  return response.data;
}

/** Fetch the advertised stream label names (the filterable low-cardinality fields). */
export async function listLabels(
  neonClient: Api<unknown>,
  scope: TelemetryScope,
): Promise<string[]> {
  const response = await neonClient.request<LokiScalarResponse>({
    path: `${tenantBaseUrl(scope)}/labels`,
    method: 'GET',
    secure: true,
  });
  assertOk(response);
  return response.data.data;
}

type LabelValuesParams = {
  scope: TelemetryScope;
  label: string;
  /** Optional LogQL stream selector to scope the values (e.g. `{entity_type="function"}`). */
  selector?: string;
  since?: string;
};

/** Fetch distinct values of one advertised label within the tenant scope + window. */
export async function listLabelValues(
  neonClient: Api<unknown>,
  params: LabelValuesParams,
): Promise<string[]> {
  const query: Record<string, string> = {};
  if (params.selector) query.query = params.selector;
  if (params.since) query.since = params.since;

  const response = await neonClient.request<LokiScalarResponse>({
    path: `${tenantBaseUrl(params.scope)}/label/${encodeURIComponent(params.label)}/values`,
    method: 'GET',
    query,
    secure: true,
  });
  assertOk(response);
  return response.data.data;
}
