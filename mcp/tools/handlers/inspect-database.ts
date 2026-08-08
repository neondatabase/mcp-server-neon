import { NeonDbError, neon } from '@neondatabase/serverless';
import { startSpan } from '@sentry/node';
import {
  INSPECT_DEFAULT_LIMIT,
  INSPECT_MAX_LIMIT,
  INSPECT_QUERIES,
  type InspectCheck,
} from '../../inspect/queries';
import { Api } from '../../neon-client';
import { NotFoundError } from '../../server/errors';
import { ToolHandlerExtraParams } from '../types';
import { handleGetConnectionString } from './connection-string';

type InspectDatabaseParams = {
  check: InspectCheck;
  projectId?: string;
  branchId?: string;
  databaseName?: string;
  computeId?: string;
  limit?: number;
};

type InspectDatabaseResult = {
  check: InspectCheck;
  describe: string;
  projectId: string;
  branchId: string;
  databaseName: string;
  fields: readonly string[];
  rowCount: number;
  rows: Record<string, unknown>[];
  truncated: boolean;
  note?: string;
};

/**
 * A failed diagnostic is a bug in this catalog, not in a caller's SQL, so it must
 * not be classified as a client error the way a failed `run_sql` is.
 * `handleToolError` returns `NeonDbError` straight to the caller without logging
 * it or reporting it to Sentry; rethrowing keeps the actionable message and gets
 * the failure recorded.
 */
async function runDiagnostic<T>(
  check: InspectCheck,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof NeonDbError) {
      throw new Error(
        `The "${check}" diagnostic failed against Postgres: ${error.message}`,
        { cause: error },
      );
    }
    throw error;
  }
}

/**
 * Runs one catalog check against a branch database and returns its rows.
 *
 * Unlike `get_connection_string`, this does not require a read-only replica in
 * read-only mode: every check is wrapped in a `READ ONLY` transaction, which is
 * the query-level protection that makes a read-write endpoint safe here.
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
    const connection = await handleGetConnectionString(
      { projectId, branchId, databaseName, computeId },
      neonClient,
      extra,
    );
    const sql = neon(connection.uri);

    if (query.requiresExtension) {
      const installed = await runDiagnostic(check, () =>
        sql.query('SELECT 1 FROM pg_extension WHERE extname = $1', [
          query.requiresExtension,
        ]),
      );
      if (installed.length === 0) {
        throw new NotFoundError(
          `The "${check}" check needs the "${query.requiresExtension}" extension, which is not installed on database "${connection.databaseName}". Enable it with: CREATE EXTENSION ${query.requiresExtension};`,
        );
      }
    }

    const [rows] = await runDiagnostic(check, () =>
      sql.transaction([sql.query(query.sql)], { readOnly: true }),
    );

    const truncated = rows.length > limit;
    let note: string | undefined;
    if (rows.length === 0) {
      note = query.emptyMessage;
    } else if (truncated && limit < INSPECT_MAX_LIMIT) {
      note = `Showing the first ${limit} of ${rows.length} rows. Raise \`limit\` to see more.`;
    } else if (truncated) {
      note = `Showing the first ${limit} of ${rows.length} rows, which is the maximum this tool returns. Narrow the question with \`run_sql\` to see the rest.`;
    }

    return {
      check,
      describe: query.describe,
      projectId: connection.projectId,
      branchId: connection.branchId,
      databaseName: connection.databaseName,
      fields: query.fields,
      rowCount: rows.length,
      rows: truncated ? rows.slice(0, limit) : rows,
      truncated,
      ...(note !== undefined && { note }),
    };
  });
}
