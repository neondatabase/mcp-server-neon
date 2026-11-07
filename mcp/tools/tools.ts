import { Api } from '../neon-client';
import { neon } from '@neondatabase/serverless';
import { NotFoundError } from '../server/errors';

import { describeTable, formatTableDescription } from '../describeUtils';
import { handleGetNeonAuthConfig } from './handlers/neon-auth-get-config';
import { handleSearch } from './handlers/search';
import { handleFetch } from './handlers/fetch';
import { getDoc, searchDocs } from './handlers/docs';
import { sendFeedback } from './handlers/feedback';

import { capStatementRows, sqlRowsContent } from './sql-rows';
import { startSpan } from '@sentry/node';
import type { z } from 'zod/v3';
import {
  ToolHandlerExtended,
  ToolHandlerExtraParams,
  ToolHandlers,
} from './types';
import {
  describeBranchInputSchema,
  describeTableSchemaInputSchema,
  explainSqlStatementInputSchema,
  fetchInputSchema,
  getConnectionStringInputSchema,
  getDatabaseTablesInputSchema,
  getDocInputSchema,
  searchDocsInputSchema,
  getNeonAuthConfigInputSchema,
  inspectDatabaseInputSchema,
  listOrganizationsInputSchema,
  listSlowQueriesInputSchema,
  runSqlInputSchema,
  runSqlTransactionInputSchema,
  searchInputSchema,
  sendFeedbackInputSchema,
} from './toolsSchema';
import { handleListOrganizations } from './handlers/list-orgs';
import { handleGetConnectionString } from './handlers/connection-string';
import { handleInspectDatabase } from './handlers/inspect-database';
import { handleDescribeBranch } from './handlers/describe-branch';
import { createGeneratedToolHandlers } from './generated/adapt';

async function handleRunSql(
  {
    sql,
    databaseName,
    projectId,
    branchId,
    roleName,
    computeId,
  }: {
    sql: string;
    databaseName?: string;
    projectId: string;
    branchId?: string;
    roleName?: string;
    computeId?: string;
  },
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
) {
  return await startSpan({ name: 'run_sql' }, async () => {
    const connectionString = await handleGetConnectionString(
      {
        projectId,
        branchId,
        databaseName,
        roleName,
        computeId,
      },
      neonClient,
      extra,
    );
    const runQuery = neon(connectionString.uri);

    // If in read-only mode, use transaction with readOnly option
    if (extra.readOnly) {
      const response = await runQuery.transaction([runQuery.query(sql)], {
        readOnly: true,
      });
      // Return the first result (the actual query result)
      return response[0];
    }

    const response = await runQuery.query(sql);

    return response;
  });
}

async function handleRunSqlTransaction(
  {
    sqlStatements,
    databaseName,
    projectId,
    branchId,
    roleName,
    computeId,
  }: {
    sqlStatements: string[];
    databaseName?: string;
    projectId: string;
    branchId?: string;
    roleName?: string;
    computeId?: string;
  },
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
) {
  const connectionString = await handleGetConnectionString(
    {
      projectId,
      branchId,
      databaseName,
      roleName,
      computeId,
    },
    neonClient,
    extra,
  );
  const runQuery = neon(connectionString.uri);

  // Use transaction with readOnly option when in read-only mode
  const response = await runQuery.transaction(
    sqlStatements.map((sql) => runQuery.query(sql)),
    extra.readOnly ? { readOnly: true } : undefined,
  );

  return response;
}

async function handleGetDatabaseTables(
  {
    projectId,
    databaseName,
    branchId,
  }: {
    projectId: string;
    databaseName?: string;
    branchId?: string;
  },
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
) {
  const connectionString = await handleGetConnectionString(
    {
      projectId,
      branchId,
      databaseName,
    },
    neonClient,
    extra,
  );
  const runQuery = neon(connectionString.uri);
  const query = `
    SELECT 
      table_schema,
      table_name,
      table_type
    FROM information_schema.tables 
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY table_schema, table_name;
  `;

  const tables = await runQuery.query(query);
  return tables;
}

async function handleDescribeTableSchema(
  {
    projectId,
    databaseName,
    branchId,
    tableName,
  }: {
    projectId: string;
    databaseName?: string;
    branchId?: string;
    tableName: string;
  },
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
) {
  const connectionString = await handleGetConnectionString(
    {
      projectId,
      branchId,
      databaseName,
    },
    neonClient,
    extra,
  );

  const description = await describeTable(connectionString.uri, tableName);
  if (!description) {
    throw new NotFoundError(`Table not found: ${tableName}`);
  }
  return {
    raw: description,
    formatted: formatTableDescription(description),
  };
}

async function handleExplainSqlStatement(
  {
    params,
  }: {
    params: {
      sql: string;
      databaseName?: string;
      projectId: string;
      branchId?: string;
      analyze: boolean;
    };
  },
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
) {
  const explainPrefix = params.analyze
    ? 'EXPLAIN (ANALYZE, VERBOSE, BUFFERS, FILECACHE, FORMAT JSON)'
    : 'EXPLAIN (VERBOSE, FORMAT JSON)';

  const explainSql = `${explainPrefix} ${params.sql}`;

  const result = await handleRunSql(
    {
      sql: explainSql,
      databaseName: params.databaseName,
      projectId: params.projectId,
      branchId: params.branchId,
    },
    neonClient,
    extra,
  );

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

async function handleListSlowQueries(
  {
    projectId,
    branchId,
    databaseName,
    computeId,
    limit = 10,
  }: {
    projectId: string;
    branchId?: string;
    databaseName?: string;
    computeId?: string;
    limit?: number;
  },
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
) {
  // Get connection string
  const connectionString = await handleGetConnectionString(
    {
      projectId,
      branchId,
      computeId,
      databaseName,
    },
    neonClient,
    extra,
  );

  // Connect to the database
  const sql = neon(connectionString.uri);

  // First, check if pg_stat_statements extension is installed
  const checkExtensionQuery = `
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'
    ) as extension_exists;
  `;

  const extensionCheck = await sql.query(checkExtensionQuery);
  const extensionExists = extensionCheck[0]?.extension_exists;

  if (!extensionExists) {
    throw new NotFoundError(
      `pg_stat_statements extension is not installed on the database. Please install it using the following command: CREATE EXTENSION pg_stat_statements;`,
    );
  }

  // Query to get slow queries
  const slowQueriesQuery = `
    SELECT 
      query,
      calls,
      total_exec_time,
      mean_exec_time,
      rows,
      shared_blks_hit,
      shared_blks_read,
      shared_blks_written,
      shared_blks_dirtied,
      temp_blks_read,
      temp_blks_written,
      wal_records,
      wal_fpi,
      wal_bytes
    FROM pg_stat_statements
    WHERE query NOT LIKE '%pg_stat_statements%'
    AND query NOT LIKE '%EXPLAIN%'
    ORDER BY mean_exec_time DESC
    LIMIT $1;
  `;

  const slowQueries = await sql.query(slowQueriesQuery, [limit]);

  // Format the results
  const formattedQueries = slowQueries.map((query: any) => {
    return {
      query: query.query,
      calls: query.calls,
      total_exec_time_ms: query.total_exec_time,
      mean_exec_time_ms: query.mean_exec_time,
      rows: query.rows,
      shared_blocks: {
        hit: query.shared_blks_hit,
        read: query.shared_blks_read,
        written: query.shared_blks_written,
        dirtied: query.shared_blks_dirtied,
      },
      temp_blocks: {
        read: query.temp_blks_read,
        written: query.temp_blks_written,
      },
      io_time: {
        read_ms: query.blk_read_time,
        write_ms: query.blk_write_time,
      },
      wal: {
        records: query.wal_records,
        full_page_images: query.wal_fpi,
        bytes: query.wal_bytes,
      },
    };
  });

  return {
    slow_queries: formattedQueries,
    total_queries_found: formattedQueries.length,
  };
}

function parseHost<T extends z.ZodTypeAny>(
  schema: T,
  params: Record<string, unknown> | undefined,
): z.infer<T> {
  return schema.parse(params ?? {});
}

function requireExtra(
  extra: ToolHandlerExtraParams | undefined,
): ToolHandlerExtraParams {
  if (!extra) {
    throw new Error('Tool requires request context');
  }
  return extra;
}

function requireClient(neonClient: Api<unknown> | undefined): Api<unknown> {
  if (!neonClient) {
    throw new Error('Tool requires a Neon client');
  }
  return neonClient;
}

function host<S extends z.ZodTypeAny>(
  schema: S,
  fn: (
    params: z.infer<S>,
    neonClient: Api<unknown>,
    extra: ToolHandlerExtraParams,
  ) => ReturnType<ToolHandlerExtended>,
): ToolHandlerExtended {
  return async (args, neonClient, extra) =>
    fn(
      parseHost(schema, args?.params),
      requireClient(neonClient),
      requireExtra(extra),
    );
}

const HOST_HANDLERS: ToolHandlers = {
  run_sql: host(runSqlInputSchema, async (params, neonClient, extra) => {
    const result = await handleRunSql(
      {
        sql: params.sql,
        databaseName: params.database_name,
        projectId: params.project_id,
        branchId: params.branch_id,
        roleName: params.role_name,
        computeId: params.compute_id,
      },
      neonClient,
      extra,
    );
    const { rows, summaries } = capStatementRows([result], params.max_rows);
    return { content: sqlRowsContent(rows[0], summaries?.[0]) };
  }),

  run_sql_transaction: host(
    runSqlTransactionInputSchema,
    async (params, neonClient, extra) => {
      const result = await handleRunSqlTransaction(
        {
          sqlStatements: params.sql_statements,
          databaseName: params.database_name,
          projectId: params.project_id,
          branchId: params.branch_id,
          roleName: params.role_name,
          computeId: params.compute_id,
        },
        neonClient,
        extra,
      );
      const { rows, summaries } = capStatementRows(result, params.max_rows);
      return { content: sqlRowsContent(rows, summaries) };
    },
  ),

  describe_table_schema: host(
    describeTableSchemaInputSchema,
    async (params, neonClient, extra) => {
      const result = await handleDescribeTableSchema(
        {
          tableName: params.table_name,
          databaseName: params.database_name,
          projectId: params.project_id,
          branchId: params.branch_id,
        },
        neonClient,
        extra,
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  ),

  get_database_tables: host(
    getDatabaseTablesInputSchema,
    async (params, neonClient, extra) => {
      const result = await handleGetDatabaseTables(
        {
          projectId: params.project_id,
          branchId: params.branch_id,
          databaseName: params.database_name,
        },
        neonClient,
        extra,
      );
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  ),

  describe_branch: host(
    describeBranchInputSchema,
    async (params, neonClient, extra) => {
      return await handleDescribeBranch(
        {
          projectId: params.project_id,
          branchId: params.branch_id,
          databaseName: params.database_name,
        },
        neonClient,
        extra,
      );
    },
  ),

  get_connection_string: host(
    getConnectionStringInputSchema,
    async (params, neonClient, extra) => {
      const result = await handleGetConnectionString(
        {
          projectId: params.project_id,
          branchId: params.branch_id,
          computeId: params.compute_id,
          databaseName: params.database_name,
          roleName: params.role_name,
        },
        neonClient,
        extra,
      );
      return {
        content: [
          {
            type: 'text',
            text: [
              'Connection string details:',
              `URI: ${result.uri}`,
              `Project ID: ${result.projectId}`,
              `Database: ${result.databaseName}`,
              `Role: ${result.roleName}`,
              result.branchId
                ? `Branch ID: ${result.branchId}`
                : 'Using default branch',
              result.computeId
                ? `Compute ID: ${result.computeId}`
                : 'Using default compute',
              '',
              'You can use this connection string with any PostgreSQL client to connect to your Neon database.',
            ].join('\n'),
          },
        ],
      };
    },
  ),

  get_neon_auth_config: host(
    getNeonAuthConfigInputSchema,
    async (params, neonClient, extra) => {
      return handleGetNeonAuthConfig(
        {
          projectId: params.project_id,
          branchId: params.branch_id,
        },
        neonClient,
        extra,
      );
    },
  ),

  explain_sql_statement: host(
    explainSqlStatementInputSchema,
    async (params, neonClient, extra) => {
      const result = await handleExplainSqlStatement(
        {
          params: {
            sql: params.sql,
            databaseName: params.database_name,
            projectId: params.project_id,
            branchId: params.branch_id,
            analyze: params.analyze,
          },
        },
        neonClient,
        extra,
      );
      return result;
    },
  ),

  list_slow_queries: host(
    listSlowQueriesInputSchema,
    async (params, neonClient, extra) => {
      const result = await handleListSlowQueries(
        {
          projectId: params.project_id,
          branchId: params.branch_id,
          databaseName: params.database_name,
          computeId: params.compute_id,
          limit: params.limit,
        },
        neonClient,
        extra,
      );
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  ),

  inspect_database: host(
    inspectDatabaseInputSchema,
    async (params, neonClient, extra) => {
      const result = await handleInspectDatabase(
        {
          check: params.check,
          projectId: params.project_id,
          branchId: params.branch_id,
          databaseName: params.database_name,
          computeId: params.compute_id,
          limit: params.limit,
        },
        neonClient,
        extra,
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  ),

  list_organizations: host(
    listOrganizationsInputSchema,
    async (params, neonClient, extra) => {
      const organizations = await handleListOrganizations(
        neonClient,
        extra.account,
        params.search,
      );
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(organizations, null, 2),
          },
        ],
      };
    },
  ),

  search: host(searchInputSchema, async (params, neonClient, extra) => {
    return await handleSearch(params, neonClient, extra);
  }),

  fetch: host(fetchInputSchema, async (params, neonClient, extra) => {
    return await handleFetch(params, neonClient, extra);
  }),

  search_docs: async (args, _neonClient, extra) => {
    const params = parseHost(searchDocsInputSchema, args?.params);
    const content = await searchDocs(params, {
      userAgent: extra?.userAgent,
      client: extra?.clientApplication,
    });
    return {
      content: [
        {
          type: 'text',
          text: content,
        },
      ],
    };
  },

  get_doc: async (args) => {
    const params = parseHost(getDocInputSchema, args?.params);
    const content = await getDoc({ slug: params.slug });
    return {
      content: [
        {
          type: 'text',
          text: content,
        },
      ],
    };
  },

  send_feedback: async (args) => {
    const params = parseHost(sendFeedbackInputSchema, args?.params);
    await sendFeedback({ feedback: params.feedback });
    return {
      content: [{ type: 'text', text: 'Feedback received. Thank you!' }],
    };
  },
};

export const NEON_HANDLERS: ToolHandlers = {
  ...HOST_HANDLERS,
  ...createGeneratedToolHandlers(),
};
