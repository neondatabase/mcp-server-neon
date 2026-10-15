import { NeonDbError, neon } from '@neondatabase/serverless';
import { startSpan } from '@sentry/node';
import {
  INSPECT_DEFAULT_LIMIT,
  INSPECT_QUERIES,
  type InspectCheck,
} from '../../inspect/queries';
import {
  assembleInspectReport,
  type InspectDatabaseBatch,
  type InspectDatabaseResult,
} from '../../inspect/report';
import {
  formatInspectQueryError,
  selectInspectTargets,
} from '../../inspect/targets';
import { Api } from '../../neon-client';
import { NotFoundError } from '../../server/errors';
import { ToolHandlerExtraParams } from '../types';
import { handleGetConnectionString } from './connection-string';
import { getDefaultBranch, getOnlyProject } from './utils';

type InspectDatabaseParams = {
  check: InspectCheck;
  projectId?: string;
  branchId?: string;
  databaseName?: string;
  computeId?: string;
  limit?: number;
};

/**
 * A diagnostic Postgres rejects is a bug in this catalog, not in a caller's SQL,
 * so it must not be classified as a client error the way a failed `run_sql` is.
 * `handleToolError` returns `NeonDbError` straight to the caller without logging
 * it or reporting it to Sentry; rethrowing keeps the actionable message and gets
 * the failure recorded.
 *
 * A connection the Neon proxy refused never ran the query, so it stays a
 * `NeonDbError`.
 */
export async function runDiagnostic<T>(
  check: InspectCheck,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof NeonDbError && !isRefusedConnection(error)) {
      throw new Error(
        `The "${check}" diagnostic failed against Postgres: ${error.message}`,
        { cause: error },
      );
    }
    throw error;
  }
}

/**
 * The proxy refuses an IP allowlist or blocked-network connection with an HTTP
 * 400 whose `severity` is empty; Postgres sets it on every error it raises. A
 * quota refusal is another 4xx, which `@neondatabase/serverless` reports only as
 * this message. A 5xx, a transport failure, or a malformed result is not a
 * refusal, and if the driver rewords the message it falls back to being reported.
 */
function isRefusedConnection(error: NeonDbError): boolean {
  return (
    error.severity === '' ||
    /^Server error \(HTTP status 4\d\d\)/.test(error.message)
  );
}

async function runInspectOnDatabase(
  check: InspectCheck,
  uri: string,
  databaseName: string,
): Promise<Record<string, unknown>[]> {
  const query = INSPECT_QUERIES[check];
  const sql = neon(uri);

  if (query.requiresExtension) {
    const installed = await runDiagnostic(check, () =>
      sql.query('SELECT 1 FROM pg_extension WHERE extname = $1', [
        query.requiresExtension,
      ]),
    );
    if (installed.length === 0) {
      throw new NotFoundError(
        `The "${check}" check needs the "${query.requiresExtension}" extension, which is not installed on database "${databaseName}". Installing it writes to the user's database, so ask the user first, then run \`CREATE EXTENSION IF NOT EXISTS ${query.requiresExtension};\` with run_sql.`,
      );
    }
  }

  const [rows] = await runDiagnostic(check, () =>
    sql.transaction([sql.query(query.sql)], { readOnly: true }),
  );
  return rows;
}

export function rethrowInspectError(
  error: unknown,
  wrapped: string | undefined,
): never {
  if (wrapped === undefined) {
    throw error instanceof Error ? error : new Error(String(error));
  }
  if (error instanceof NotFoundError) {
    throw new NotFoundError(wrapped);
  }
  if (error instanceof NeonDbError) {
    throw Object.assign(new NeonDbError(wrapped), { cause: error });
  }
  throw new Error(wrapped, {
    cause: error instanceof Error ? error : undefined,
  });
}

/**
 * Every check runs in a `READ ONLY` transaction, so read-only mode does not
 * require a read-only replica.
 */
export async function handleInspectDatabase(
  {
    check,
    projectId,
    branchId,
    databaseName,
    computeId,
    limit = INSPECT_DEFAULT_LIMIT,
  }: InspectDatabaseParams,
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
): Promise<InspectDatabaseResult> {
  return await startSpan({ name: 'inspect_database' }, async () => {
    const query = INSPECT_QUERIES[check];

    if (!projectId) {
      const project = await getOnlyProject(neonClient, extra);
      projectId = project.id;
    }
    if (!branchId) {
      const defaultBranch = await getDefaultBranch(projectId, neonClient);
      branchId = defaultBranch.id;
    }

    let branchDatabaseCount = 1;
    let selection;
    if (databaseName !== undefined) {
      selection = selectInspectTargets({
        databaseName,
        branchDatabases: [],
        scope: query.scope,
      });
    } else {
      const { data } = await neonClient.listProjectBranchDatabases(
        projectId,
        branchId,
      );
      const branchDatabases = data.databases.map((database) => database.name);
      if (branchDatabases.length === 0) {
        throw new NotFoundError('No databases found in your project branch');
      }
      branchDatabaseCount = branchDatabases.length;
      selection = selectInspectTargets({
        branchDatabases,
        scope: query.scope,
      });
    }

    const batches: InspectDatabaseBatch[] = [];
    for (const name of selection.databases) {
      try {
        const connection = await handleGetConnectionString(
          { projectId, branchId, databaseName: name, computeId },
          neonClient,
          extra,
        );
        batches.push({
          database: name,
          rows: await runInspectOnDatabase(check, connection.uri, name),
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        rethrowInspectError(
          error,
          formatInspectQueryError({
            reason,
            database: name,
            databaseName,
            offerDatabaseNameHint: branchDatabaseCount > 1,
            scope: query.scope,
            requiresExtension: query.requiresExtension,
          }),
        );
      }
    }

    return assembleInspectReport({
      check,
      query,
      projectId,
      branchId,
      batches,
      includeDatabaseColumn: selection.includeDatabaseColumn,
      includeDatabaseName: databaseName !== undefined,
      limit,
    });
  });
}
