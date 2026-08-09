/**
 * Handlers for the logs tools: query_logs, list_log_fields,
 * list_log_field_values. These call `neon.logs.*` through the client facade.
 *
 * Structured MCP filters use the SDK's structured inputs. They are also
 * rendered as equivalent LogQL for the response and for minimum severity,
 * whose structured API filter is not supported consistently across backends.
 */

import type { Api, ProjectBranchLogRecord } from '../../neon-client';
import { z } from 'zod/v3';
import { InvalidArgumentError } from '../../server/errors';
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
  if (params.logql !== undefined && params.query !== undefined) {
    throw new InvalidArgumentError(
      'Provide either `logql` or its legacy `query` alias, not both.',
    );
  }

  const rawLogQL = params.logql ?? params.query;
  const conflictingFilters = structuredFilterNames(params);
  if (rawLogQL !== undefined && conflictingFilters.length > 0) {
    const rawField = params.logql !== undefined ? 'logql' : 'query';
    throw new InvalidArgumentError(
      `Raw \`${rawField}\` cannot be combined with structured log filters (${conflictingFilters.join(', ')}). Remove those filters, or omit \`${rawField}\` and use structured filters alone.`,
    );
  }

  const scope = await resolveScope(params, neonClient, extra);

  const query = rawLogQL ?? renderLogQL(params);
  const filters =
    rawLogQL !== undefined
      ? { logql: rawLogQL }
      : params.minSeverity
        ? // Preserve minimum-severity behavior on branch backends that reject
          // the API's structured minimum_severity filter.
          { logql: query }
        : {
            source: params.source ?? 'function',
            service_name: params.serviceName,
            severity_text: params.severityText,
            body_contains: params.bodyContains,
            trace_id: params.traceId,
          };

  // Absolute (startTime) and relative (since) windows are mutually exclusive;
  // with neither, look back one hour.
  const timeWindow = params.startTime
    ? { start_time: params.startTime, end_time: params.endTime }
    : { since: params.since ?? '1h', end_time: params.endTime };

  const page = await neonClient.queryLogs(scope.projectId, scope.branchId, {
    ...filters,
    ...timeWindow,
    limit: params.limit,
    sort_order: 'desc',
  });

  return {
    query,
    logql: query,
    scope,
    count: page.items.length,
    // A cursor is only issued when more records matched than were returned.
    truncated: Boolean(page.cursor),
    records: page.items.map(toLogRecord),
  };
}

function structuredFilterNames(params: QueryLogsParams): string[] {
  const filters: string[] = [];
  if (params.source !== undefined) filters.push('source');
  if (params.serviceName !== undefined) filters.push('serviceName');
  if (params.minSeverity !== undefined) filters.push('minSeverity');
  if (params.severityText !== undefined) filters.push('severityText');
  if (params.bodyContains !== undefined) filters.push('bodyContains');
  if (params.traceId !== undefined) filters.push('traceId');
  return filters;
}

/** Render structured filters as equivalent LogQL for the response or fallback. */
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
