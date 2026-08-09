/**
 * Handlers for the logs tools: query_logs, list_log_fields,
 * list_log_field_values. These call `neon.logs.*` through the client facade.
 *
 * Structured MCP filters are rendered into the same LogQL expression the
 * previous transport executed, then sent through the SDK's raw-LogQL input.
 * That keeps the tool's filtering semantics and returned `query` reproducible.
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
    timestamp: new Date(record.timestamp).toISOString(),
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

  // Preserve the previous tool's LogQL semantics through the SDK transport.
  // Besides making the returned query exactly reproducible, this keeps
  // minSeverity working on branch backends that reject minimum_severity.
  const query = params.query ?? renderLogQL(params);

  // Absolute (startTime) and relative (since) windows are mutually exclusive;
  // with neither, look back one hour.
  const timeWindow = params.startTime
    ? { start_time: params.startTime, end_time: params.endTime }
    : { since: params.since ?? '1h', end_time: params.endTime };

  const page = await neonClient.queryLogs(scope.projectId, scope.branchId, {
    logql: query,
    ...timeWindow,
    limit: params.limit,
    sort_order: 'desc',
  });

  return {
    query,
    scope,
    count: page.items.length,
    // A cursor is only issued when more records matched than were returned.
    truncated: Boolean(page.cursor),
    records: page.items.map(toLogRecord),
  };
}

/** Render structured filters into the LogQL sent through the SDK. */
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
