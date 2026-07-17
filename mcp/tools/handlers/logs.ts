/**
 * Handlers for the OpenTelemetry logs tools: query_logs, list_log_fields,
 * list_log_field_values. These call the Neon telemetry read API (see mcp/otel).
 */

import type { Api } from '@neondatabase/api-client';
import { z } from 'zod/v3';
import type { ToolHandlerExtraParams } from '../types';
import { getDefaultBranch, getOnlyProject } from './utils';
import { listLabelValues, listLabels, queryRange } from '../../otel/client';
import { buildLogQL } from '../../otel/logql';
import { flattenLokiResponse } from '../../otel/format';
import type { TelemetryScope } from '../../otel/types';
import type {
  queryLogsInputSchema,
  listLogFieldsInputSchema,
  listLogFieldValuesInputSchema,
} from '../toolsSchema';

type QueryLogsParams = z.infer<typeof queryLogsInputSchema>;
type ListLogFieldsParams = z.infer<typeof listLogFieldsInputSchema>;
type ListLogFieldValuesParams = z.infer<typeof listLogFieldValuesInputSchema>;

/** Resolve projectId (falling back to the only project) + branchId (default branch). */
async function resolveScope(
  params: { projectId?: string; branchId?: string },
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
): Promise<TelemetryScope> {
  let projectId = params.projectId;
  if (!projectId) {
    const project = await getOnlyProject(neonClient, extra);
    projectId = project.id;
  }
  let branchId = params.branchId;
  if (!branchId) {
    const defaultBranch = await getDefaultBranch(projectId, neonClient);
    branchId = defaultBranch.id;
  }
  return { projectId, branchId };
}

export async function handleQueryLogs(
  params: QueryLogsParams,
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
) {
  const scope = await resolveScope(params, neonClient, extra);

  // A raw LogQL expression takes over from the structured filters entirely.
  // buildLogQL owns severityText-over-minSeverity precedence.
  const logql =
    params.query ??
    buildLogQL({
      entityType: params.source,
      serviceName: params.serviceName,
      severityText: params.severityText,
      minSeverity: params.minSeverity,
      bodyContains: params.bodyContains,
      traceId: params.traceId,
    });

  // Absolute window (startTime) wins over relative (since); default to last 1h.
  const useAbsolute = Boolean(params.startTime);
  const response = await queryRange(neonClient, {
    scope,
    query: logql,
    start: useAbsolute ? params.startTime : undefined,
    end: useAbsolute ? params.endTime : undefined,
    since: useAbsolute ? undefined : (params.since ?? '1h'),
    limit: params.limit,
    direction: 'backward',
  });

  const { records, truncated, warnings } = flattenLokiResponse(
    response,
    params.limit,
  );

  return {
    query: logql,
    scope,
    count: records.length,
    truncated,
    ...(warnings.length > 0 && { warnings }),
    records,
  };
}

export async function handleListLogFields(
  params: ListLogFieldsParams,
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
) {
  const scope = await resolveScope(params, neonClient, extra);
  const fields = await listLabels(neonClient, scope);
  return { scope, fields };
}

export async function handleListLogFieldValues(
  params: ListLogFieldValuesParams,
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
) {
  const scope = await resolveScope(params, neonClient, extra);
  const values = await listLabelValues(neonClient, {
    scope,
    label: params.field,
    since: params.since,
  });
  return { scope, field: params.field, values };
}
