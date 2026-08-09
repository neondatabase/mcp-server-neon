/**
 * Handlers for the logs tools: query_logs, list_log_fields,
 * list_log_field_values. These call `neon.logs.*` through the client facade.
 *
 * The MCP surface is camelCase and the API is snake_case, so the mapping lives
 * here. `mcp/otel/logql` renders the equivalent LogQL expression reported back
 * as `query`; it is not what gets sent.
 */

import type { Api, ProjectBranchLogRecord } from '../../neon-client';
import { z } from 'zod/v3';
import type { ToolHandlerExtraParams } from '../types';
import { getDefaultBranch, getOnlyProject } from './utils';
import { buildLogQL } from '../../otel/logql';
import type {
  queryLogsInputSchema,
  listLogFieldsInputSchema,
  listLogFieldValuesInputSchema,
} from '../toolsSchema';

type QueryLogsParams = z.infer<typeof queryLogsInputSchema>;
type ListLogFieldsParams = z.infer<typeof listLogFieldsInputSchema>;
type ListLogFieldValuesParams = z.infer<typeof listLogFieldValuesInputSchema>;

/** The project + branch every logs call is scoped to. */
type LogScope = {
  projectId: string;
  branchId: string;
};

/** A log record as returned to the LLM. */
type LogRecord = {
  timestamp: string;
  severity?: string;
  serviceName?: string;
  scopeName?: string;
  entityType?: string;
  body: string;
};

/** Resolve projectId (falling back to the only project) + branchId (default branch). */
async function resolveScope(
  params: { projectId?: string; branchId?: string },
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
): Promise<LogScope> {
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

function toLogRecord(record: ProjectBranchLogRecord): LogRecord {
  return {
    timestamp: record.timestamp,
    severity: record.severity_text,
    serviceName: record.service_name,
    scopeName: record.scope_name,
    entityType: record.source,
    body: record.message,
  };
}

export async function handleQueryLogs(
  params: QueryLogsParams,
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
) {
  const scope = await resolveScope(params, neonClient, extra);

  // A raw LogQL expression replaces the structured filters rather than adding to
  // them — the API rejects the two together, so not even the defaulted source
  // may ride along. An exact severityText wins over the minSeverity threshold.
  const filters = params.query
    ? { logql: params.query }
    : {
        source: params.source,
        service_name: params.serviceName,
        severity_text: params.severityText,
        minimum_severity: params.severityText ? undefined : params.minSeverity,
        body_contains: params.bodyContains,
        trace_id: params.traceId,
      };

  // Absolute (startTime) and relative (since) windows are mutually exclusive;
  // with neither, look back one hour.
  const timeWindow = params.startTime
    ? { start_time: params.startTime, end_time: params.endTime }
    : { since: params.since ?? '1h' };

  const page = await neonClient.queryLogs(scope.projectId, scope.branchId, {
    ...filters,
    ...timeWindow,
    limit: params.limit,
    sort_order: 'desc',
  });

  return {
    query: params.query ?? renderLogQL(params),
    scope,
    count: page.items.length,
    // A cursor is only issued when more records matched than were returned.
    truncated: Boolean(page.cursor),
    records: page.items.map(toLogRecord),
  };
}

/** The LogQL the structured filters stand for, reported back for reuse as `query`. */
function renderLogQL(params: QueryLogsParams): string {
  return buildLogQL({
    entityType: params.source,
    serviceName: params.serviceName,
    severityText: params.severityText,
    minSeverity: params.minSeverity,
    bodyContains: params.bodyContains,
    traceId: params.traceId,
  });
}

export async function handleListLogFields(
  params: ListLogFieldsParams,
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
) {
  const scope = await resolveScope(params, neonClient, extra);
  const fields = await neonClient.listLogFields(
    scope.projectId,
    scope.branchId,
  );
  return { scope, fields };
}

export async function handleListLogFieldValues(
  params: ListLogFieldValuesParams,
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
) {
  const scope = await resolveScope(params, neonClient, extra);
  const response = await neonClient.listLogFieldValues(
    scope.projectId,
    scope.branchId,
    params.field,
    params.since ? { since: params.since } : undefined,
  );
  return {
    scope,
    field: params.field,
    values: response.values,
    // A partial list is an arbitrary subset: narrow the window and ask again.
    truncated: response.is_truncated,
  };
}
