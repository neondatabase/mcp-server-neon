import { Api, Branch, EndpointType } from '../neon-client';
import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';
import { NotFoundError } from '../server/errors';

import { describeTable, formatTableDescription } from '../describeUtils';
import { handleGetNeonAuthConfig } from './handlers/neon-auth-get-config';
import { handleSearch } from './handlers/search';
import { handleFetch } from './handlers/fetch';
import { getDocResource, listDocsResources } from './handlers/docs';

import { getDefaultDatabase, splitSqlStatements } from './utils';
import { startSpan } from '@sentry/node';
import type { z } from 'zod/v3';
import {
  ToolHandlerExtended,
  ToolHandlerExtraParams,
  ToolHandlers,
} from './types';
import {
  completeDatabaseMigrationInputSchema,
  completeQueryTuningInputSchema,
  describeBranchInputSchema,
  describeTableSchemaInputSchema,
  explainSqlStatementInputSchema,
  fetchInputSchema,
  getConnectionStringInputSchema,
  getDatabaseTablesInputSchema,
  getDocResourceInputSchema,
  getNeonAuthConfigInputSchema,
  inspectDatabaseInputSchema,
  listOrganizationsInputSchema,
  listSlowQueriesInputSchema,
  prepareDatabaseMigrationInputSchema,
  prepareQueryTuningInputSchema,
  runSqlInputSchema,
  runSqlTransactionInputSchema,
  searchInputSchema,
} from './toolsSchema';
import { handleListOrganizations } from './handlers/list-orgs';
import { handleGetConnectionString } from './handlers/connection-string';
import { handleInspectDatabase } from './handlers/inspect-database';
import { handleDescribeBranch } from './handlers/describe-branch';
import { createGeneratedToolHandlers } from './generated/adapt';

/**
 * Generates a unique, identifiable branch name for migrations.
 * Format: mcp-migration-YYYY-MM-DDTHH-mm-ss
 * This makes orphaned branches easy to identify and clean up.
 */
function generateMigrationBranchName(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `mcp-migration-${timestamp}`;
}

async function handleRunSql(
  {
    sql,
    databaseName,
    projectId,
    branchId,
  }: {
    sql: string;
    databaseName?: string;
    projectId: string;
    branchId?: string;
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
  }: {
    sqlStatements: string[];
    databaseName?: string;
    projectId: string;
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

async function handleCreateBranch(
  {
    projectId,
    branchName,
    parentId,
    expiresAt,
  }: {
    projectId: string;
    branchName?: string;
    parentId?: string;
    expiresAt?: string;
  },
  neonClient: Api<unknown>,
) {
  const response = await neonClient.createProjectBranch(projectId, {
    branch: {
      name: branchName,
      parent_id: parentId,
      expires_at: expiresAt,
    },
    endpoints: [
      {
        type: EndpointType.ReadWrite,
        autoscaling_limit_min_cu: 0.25,
        autoscaling_limit_max_cu: 0.25,
      },
    ],
  });

  if (response.status !== 201) {
    throw new Error(`Failed to create branch: ${response.statusText}`);
  }

  return response.data;
}

async function handleDeleteBranch(
  {
    projectId,
    branchId,
  }: {
    projectId: string;
    branchId: string;
  },
  neonClient: Api<unknown>,
) {
  const response = await neonClient.deleteProjectBranch(projectId, branchId);
  return response.data;
}

async function handleSchemaMigration(
  {
    migrationSql,
    databaseName,
    projectId,
  }: {
    databaseName?: string;
    projectId: string;
    migrationSql: string;
  },
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
) {
  return await startSpan({ name: 'prepare_schema_migration' }, async (span) => {
    let newBranch: { branch: Branch } | undefined;

    try {
      // Create branch with identifiable name for easy orphan cleanup
      const branchName = generateMigrationBranchName();
      const createdBranch = await handleCreateBranch(
        { projectId, branchName },
        neonClient,
      );
      newBranch = createdBranch;

      let resolvedDatabaseName = databaseName;
      if (!resolvedDatabaseName) {
        const dbObject = await getDefaultDatabase(
          {
            projectId,
            branchId: createdBranch.branch.id,
            databaseName,
          },
          neonClient,
        );
        resolvedDatabaseName = dbObject.name;
      }

      const result = await handleRunSqlTransaction(
        {
          sqlStatements: splitSqlStatements(migrationSql),
          databaseName: resolvedDatabaseName,
          projectId,
          branchId: createdBranch.branch.id,
        },
        neonClient,
        extra,
      );

      const migrationId = crypto.randomUUID();
      span.setAttributes({
        projectId,
        migrationId,
      });

      // Return all context needed for completion (stateless approach)
      // No in-memory state storage - LLM will pass these back
      return {
        migrationId,
        migrationSql,
        databaseName: resolvedDatabaseName,
        projectId,
        branch: createdBranch.branch,
        parentBranchId: createdBranch.branch.parent_id,
        migrationResult: result,
      };
    } catch (error) {
      // Clean up orphaned branch if it was created
      if (newBranch) {
        try {
          await handleDeleteBranch(
            { projectId, branchId: newBranch.branch.id },
            neonClient,
          );
        } catch {
          // Ignore cleanup errors - branch naming makes orphans identifiable
        }
      }
      throw error;
    }
  });
}

async function handleCommitMigration(
  {
    migrationId,
    migrationSql,
    databaseName,
    projectId,
    temporaryBranchId,
    parentBranchId,
    applyChanges,
  }: {
    migrationId: string;
    migrationSql: string;
    databaseName: string;
    projectId: string;
    temporaryBranchId: string;
    parentBranchId: string;
    applyChanges: boolean;
  },
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
) {
  return await startSpan({ name: 'commit_schema_migration' }, async (span) => {
    span.setAttributes({
      migrationId,
      projectId,
    });

    let migrationResult;
    if (applyChanges) {
      // Apply migration to parent branch
      migrationResult = await handleRunSqlTransaction(
        {
          sqlStatements: splitSqlStatements(migrationSql),
          databaseName,
          projectId,
          branchId: parentBranchId,
        },
        neonClient,
        extra,
      );
    }

    // Always clean up temporary branch
    let branchDeleted = true;
    let cleanupError: string | undefined;
    try {
      await handleDeleteBranch(
        {
          projectId,
          branchId: temporaryBranchId,
        },
        neonClient,
      );
    } catch (error) {
      branchDeleted = false;
      cleanupError = (error as Error).message;
    }

    return {
      applied: applyChanges,
      deletedBranchId: branchDeleted ? temporaryBranchId : undefined,
      cleanupError,
      migrationResult,
    };
  });
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

async function createTemporaryBranch(
  projectId: string,
  neonClient: Api<unknown>,
): Promise<{ branch: Branch }> {
  const result = await handleCreateBranch({ projectId }, neonClient);
  if (!result?.branch) {
    throw new Error('Failed to create temporary branch');
  }
  return result;
}

type QueryTuningParams = {
  sql: string;
  databaseName: string;
  projectId: string;
};

type CompleteTuningParams = {
  suggestedSqlStatements?: string[];
  applyChanges?: boolean;
  tuningId: string;
  databaseName: string;
  projectId: string;
  temporaryBranch: Branch;
  shouldDeleteTemporaryBranch?: boolean;
  branch?: Branch;
};

type QueryTuningResult = {
  tuningId: string;
  databaseName: string;
  projectId: string;
  temporaryBranch: Branch;
  originalPlan: any;
  tableSchemas: any[];
  sql: string;
  baselineMetrics: QueryMetrics;
};

type CompleteTuningResult = {
  appliedChanges?: string[];
  results?: any;
  deletedBranches?: string[];
  message: string;
};

async function handleQueryTuning(
  params: QueryTuningParams,
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
): Promise<QueryTuningResult> {
  let tempBranch: Branch | undefined;
  const tuningId = crypto.randomUUID();

  try {
    // Create temporary branch
    const newBranch = await createTemporaryBranch(params.projectId, neonClient);
    if (!newBranch.branch) {
      throw new Error('Failed to create temporary branch: branch is undefined');
    }
    tempBranch = newBranch.branch;

    // Ensure all operations use the temporary branch
    const branchParams = {
      ...params,
      branchId: tempBranch.id,
    };

    // First, get the execution plan with table information
    const executionPlan = await handleExplainSqlStatement(
      {
        params: {
          sql: branchParams.sql,
          databaseName: branchParams.databaseName,
          projectId: branchParams.projectId,
          branchId: tempBranch.id,
          analyze: true,
        },
      },
      neonClient,
      extra,
    );

    // Extract table names from the plan
    const tableNames = extractTableNamesFromPlan(executionPlan);

    if (tableNames.length === 0) {
      throw new NotFoundError(
        'No tables found in execution plan. Cannot proceed with optimization.',
      );
    }

    // Get schema information for all referenced tables in parallel
    const tableSchemas = await Promise.all(
      tableNames.map(async (tableName) => {
        try {
          const schema = await handleDescribeTableSchema(
            {
              tableName,
              databaseName: branchParams.databaseName,
              projectId: branchParams.projectId,
              branchId: newBranch.branch.id,
            },
            neonClient,
            extra,
          );
          return {
            tableName,
            schema: schema.raw,
            formatted: schema.formatted,
          };
        } catch (error) {
          throw new Error(
            `Failed to get schema for table ${tableName}: ${
              (error as Error).message
            }`,
          );
        }
      }),
    );

    // Get the baseline execution metrics
    const baselineMetrics = extractExecutionMetrics(executionPlan);

    // Return the information for analysis
    const result: QueryTuningResult = {
      tuningId,
      databaseName: params.databaseName,
      projectId: params.projectId,
      temporaryBranch: tempBranch,
      originalPlan: executionPlan,
      tableSchemas,
      sql: params.sql,
      baselineMetrics,
    };

    return result;
  } catch (error) {
    // Always attempt to clean up the temporary branch if it was created
    if (tempBranch) {
      try {
        await handleDeleteBranch(
          {
            projectId: params.projectId,
            branchId: tempBranch.id,
          },
          neonClient,
        );
      } catch {
        // No need to handle cleanup error
      }
    }

    throw error;
  }
}

// Helper function to extract execution metrics from EXPLAIN output
function extractExecutionMetrics(plan: any): QueryMetrics {
  try {
    const planJson =
      typeof plan.content?.[0]?.text === 'string'
        ? JSON.parse(plan.content[0].text)
        : plan;

    const metrics: QueryMetrics = {
      executionTime: 0,
      planningTime: 0,
      totalCost: 0,
      actualRows: 0,
      bufferUsage: {
        shared: { hit: 0, read: 0, written: 0, dirtied: 0 },
        local: { hit: 0, read: 0, written: 0, dirtied: 0 },
      },
    };

    // Extract planning and execution time if available
    if (planJson?.[0]?.['Planning Time']) {
      metrics.planningTime = planJson[0]['Planning Time'];
    }
    if (planJson?.[0]?.['Execution Time']) {
      metrics.executionTime = planJson[0]['Execution Time'];
    }

    // Recursively process plan nodes to accumulate costs and buffer usage
    function processNode(node: any) {
      if (!node || typeof node !== 'object') return;

      // Accumulate costs
      if (node['Total Cost']) {
        metrics.totalCost = Math.max(metrics.totalCost, node['Total Cost']);
      }
      if (node['Actual Rows']) {
        metrics.actualRows += node['Actual Rows'];
      }

      if (node['Shared Hit Blocks'])
        metrics.bufferUsage.shared.hit += node['Shared Hit Blocks'];
      if (node['Shared Read Blocks'])
        metrics.bufferUsage.shared.read += node['Shared Read Blocks'];
      if (node['Shared Written Blocks'])
        metrics.bufferUsage.shared.written += node['Shared Written Blocks'];
      if (node['Shared Dirtied Blocks'])
        metrics.bufferUsage.shared.dirtied += node['Shared Dirtied Blocks'];

      if (node['Local Hit Blocks'])
        metrics.bufferUsage.local.hit += node['Local Hit Blocks'];
      if (node['Local Read Blocks'])
        metrics.bufferUsage.local.read += node['Local Read Blocks'];
      if (node['Local Written Blocks'])
        metrics.bufferUsage.local.written += node['Local Written Blocks'];
      if (node['Local Dirtied Blocks'])
        metrics.bufferUsage.local.dirtied += node['Local Dirtied Blocks'];

      // Process child nodes
      if (Array.isArray(node.Plans)) {
        node.Plans.forEach(processNode);
      }
    }

    if (planJson?.[0]?.Plan) {
      processNode(planJson[0].Plan);
    }

    return metrics;
  } catch {
    return {
      executionTime: 0,
      planningTime: 0,
      totalCost: 0,
      actualRows: 0,
      bufferUsage: {
        shared: { hit: 0, read: 0, written: 0, dirtied: 0 },
        local: { hit: 0, read: 0, written: 0, dirtied: 0 },
      },
    };
  }
}

// Types for query metrics
type BufferMetrics = {
  hit: number;
  read: number;
  written: number;
  dirtied: number;
};

type QueryMetrics = {
  executionTime: number;
  planningTime: number;
  totalCost: number;
  actualRows: number;
  bufferUsage: {
    shared: BufferMetrics;
    local: BufferMetrics;
  };
};

// Function to extract table names from an execution plan
function extractTableNamesFromPlan(planResult: any): string[] {
  const tableNames = new Set<string>();

  function recursivelyExtractFromNode(node: any) {
    if (!node || typeof node !== 'object') return;

    // Check if current node has relation information
    if (node['Relation Name'] && node.Schema) {
      const tableName = `${node.Schema}.${node['Relation Name']}`;
      tableNames.add(tableName);
    }

    // Recursively process all object properties and array elements
    if (Array.isArray(node)) {
      node.forEach((item) => {
        recursivelyExtractFromNode(item);
      });
    } else {
      Object.values(node).forEach((value) => {
        recursivelyExtractFromNode(value);
      });
    }
  }

  try {
    // Start with the raw plan result
    recursivelyExtractFromNode(planResult);

    // If we have content[0].text, also parse and process that
    if (planResult?.content?.[0]?.text) {
      try {
        const parsedContent = JSON.parse(planResult.content[0].text);
        recursivelyExtractFromNode(parsedContent);
      } catch {
        // No need to handle parse error
      }
    }
  } catch {
    // No need to handle extraction error
  }

  const result = Array.from(tableNames);
  return result;
}

async function handleCompleteTuning(
  params: CompleteTuningParams,
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
): Promise<CompleteTuningResult> {
  let results;
  const operationLog: string[] = [];

  try {
    // Validate branch information
    if (!params.temporaryBranch) {
      throw new Error(
        'Branch information is required for completing query tuning',
      );
    }

    // Only proceed with changes if we have both suggestedChanges and branch
    if (
      params.applyChanges &&
      params.suggestedSqlStatements &&
      params.suggestedSqlStatements.length > 0
    ) {
      operationLog.push('Applying optimizations to main branch...');

      results = await handleRunSqlTransaction(
        {
          sqlStatements: params.suggestedSqlStatements,
          databaseName: params.databaseName,
          projectId: params.projectId,
          branchId: params.branch?.id,
        },
        neonClient,
        extra,
      );

      operationLog.push('Successfully applied optimizations to main branch.');
    } else {
      operationLog.push(
        'No changes were applied (either none suggested or changes were discarded).',
      );
    }

    // Only delete branch if shouldDeleteTemporaryBranch is true
    if (params.shouldDeleteTemporaryBranch && params.temporaryBranch) {
      operationLog.push('Cleaning up temporary branch...');

      await handleDeleteBranch(
        {
          projectId: params.projectId,
          branchId: params.temporaryBranch.id,
        },
        neonClient,
      );

      operationLog.push('Successfully cleaned up temporary branch.');
    }

    const result: CompleteTuningResult = {
      appliedChanges:
        params.applyChanges && params.suggestedSqlStatements
          ? params.suggestedSqlStatements
          : undefined,
      results,
      deletedBranches:
        params.shouldDeleteTemporaryBranch && params.temporaryBranch
          ? [params.temporaryBranch.id]
          : undefined,
      message: operationLog.join('\n'),
    };

    return result;
  } catch (error) {
    throw new Error(
      `Failed to complete query tuning: ${(error as Error).message}`,
    );
  }
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
        databaseName: params.databaseName,
        projectId: params.projectId,
        branchId: params.branchId,
      },
      neonClient,
      extra,
    );
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }),

  run_sql_transaction: host(
    runSqlTransactionInputSchema,
    async (params, neonClient, extra) => {
      const result = await handleRunSqlTransaction(
        {
          sqlStatements: params.sqlStatements,
          databaseName: params.databaseName,
          projectId: params.projectId,
          branchId: params.branchId,
        },
        neonClient,
        extra,
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  ),

  describe_table_schema: host(
    describeTableSchemaInputSchema,
    async (params, neonClient, extra) => {
      const result = await handleDescribeTableSchema(
        {
          tableName: params.tableName,
          databaseName: params.databaseName,
          projectId: params.projectId,
          branchId: params.branchId,
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
          projectId: params.projectId,
          branchId: params.branchId,
          databaseName: params.databaseName,
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

  prepare_database_migration: host(
    prepareDatabaseMigrationInputSchema,
    async (params, neonClient, extra) => {
      const result = await handleSchemaMigration(
        {
          migrationSql: params.migrationSql,
          databaseName: params.databaseName,
          projectId: params.projectId,
        },
        neonClient,
        extra,
      );
      return {
        content: [
          {
            type: 'text',
            text: `
<status>Migration created successfully in temporary branch</status>

<migration_context>
You MUST pass ALL these values to complete_database_migration:
- migrationId: ${result.migrationId}
- migrationSql: ${result.migrationSql}
- databaseName: ${result.databaseName}
- projectId: ${result.projectId}
- temporaryBranchId: ${result.branch.id}
- parentBranchId: ${result.parentBranchId}
</migration_context>

<temporary_branch>
- Name: ${result.branch.name}
- ID: ${result.branch.id}
- Parent Branch ID: ${result.parentBranchId}
</temporary_branch>

<execution_result>${JSON.stringify(
              result.migrationResult,
              null,
              2,
            )}</execution_result>

<next_actions>
You MUST follow these steps:
1. Test this migration using \`run_sql\` tool on branch \`${
              result.branch.name
            }\` (branch ID: ${result.branch.id})
2. Verify the changes meet your requirements
3. If satisfied, use \`complete_database_migration\` with ALL the values from migration_context above
4. If not satisfied, use \`complete_database_migration\` with applyChanges: false to cancel and cleanup
</next_actions>
            `,
          },
        ],
      };
    },
  ),

  complete_database_migration: host(
    completeDatabaseMigrationInputSchema,
    async (params, neonClient, extra) => {
      const result = await handleCommitMigration(
        {
          migrationId: params.migrationId,
          migrationSql: params.migrationSql,
          databaseName: params.databaseName,
          projectId: params.projectId,
          temporaryBranchId: params.temporaryBranchId,
          parentBranchId: params.parentBranchId,
          applyChanges: params.applyChanges,
        },
        neonClient,
        extra,
      );
      let message: string;
      if (result.applied) {
        message = result.deletedBranchId
          ? `Migration applied successfully to parent branch. Temporary branch ${result.deletedBranchId} deleted.\n\nResult: ${JSON.stringify(result.migrationResult, null, 2)}`
          : `Migration applied successfully to parent branch.\n\n⚠️ Warning: Failed to delete temporary branch. Manual cleanup may be required. Error: ${result.cleanupError}\n\nResult: ${JSON.stringify(result.migrationResult, null, 2)}`;
      } else {
        message = result.deletedBranchId
          ? `Migration cancelled. Temporary branch ${result.deletedBranchId} deleted without applying changes.`
          : `Migration cancelled.\n\n⚠️ Warning: Failed to delete temporary branch. Manual cleanup may be required. Error: ${result.cleanupError}`;
      }

      return {
        content: [{ type: 'text', text: message }],
      };
    },
  ),

  describe_branch: host(
    describeBranchInputSchema,
    async (params, neonClient, extra) => {
      return await handleDescribeBranch(
        {
          projectId: params.projectId,
          branchId: params.branchId,
          databaseName: params.databaseName,
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
          projectId: params.projectId,
          branchId: params.branchId,
          computeId: params.computeId,
          databaseName: params.databaseName,
          roleName: params.roleName,
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
      return handleGetNeonAuthConfig(params, neonClient, extra);
    },
  ),

  explain_sql_statement: host(
    explainSqlStatementInputSchema,
    async (params, neonClient, extra) => {
      const result = await handleExplainSqlStatement(
        { params },
        neonClient,
        extra,
      );
      return result;
    },
  ),

  prepare_query_tuning: host(
    prepareQueryTuningInputSchema,
    async (params, neonClient, extra) => {
      const result = await handleQueryTuning(
        {
          sql: params.sql,
          databaseName: params.databaseName,
          projectId: params.projectId,
        },
        neonClient,
        extra,
      );
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                tuningId: result.tuningId,
                databaseName: result.databaseName,
                projectId: result.projectId,
                temporaryBranch: result.temporaryBranch,
                executionPlan: result.originalPlan,
                tableSchemas: result.tableSchemas,
                sql: result.sql,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  ),

  complete_query_tuning: host(
    completeQueryTuningInputSchema,
    async (params, neonClient, extra) => {
      const result = await handleCompleteTuning(
        {
          suggestedSqlStatements: params.suggestedSqlStatements,
          applyChanges: params.applyChanges,
          tuningId: params.tuningId,
          databaseName: params.databaseName,
          projectId: params.projectId,
          temporaryBranch: {
            id: params.temporaryBranchId,
            project_id: params.projectId,
          } as Branch,
          shouldDeleteTemporaryBranch: params.shouldDeleteTemporaryBranch,
          branch: params.branchId
            ? ({ id: params.branchId, project_id: params.projectId } as Branch)
            : undefined,
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

  list_slow_queries: host(
    listSlowQueriesInputSchema,
    async (params, neonClient, extra) => {
      const result = await handleListSlowQueries(
        {
          projectId: params.projectId,
          branchId: params.branchId,
          databaseName: params.databaseName,
          computeId: params.computeId,
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
          projectId: params.projectId,
          branchId: params.branchId,
          databaseName: params.databaseName,
          computeId: params.computeId,
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

  list_docs_resources: async () => {
    const content = await listDocsResources();
    return {
      content: [
        {
          type: 'text',
          text: content,
        },
      ],
    };
  },

  get_doc_resource: async (args) => {
    const params = parseHost(getDocResourceInputSchema, args?.params);
    const content = await getDocResource({ slug: params.slug });
    return {
      content: [
        {
          type: 'text',
          text: content,
        },
      ],
    };
  },
};

export const NEON_HANDLERS: ToolHandlers = {
  ...HOST_HANDLERS,
  ...createGeneratedToolHandlers(),
};
