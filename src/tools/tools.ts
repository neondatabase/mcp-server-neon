import {
  Api,
  Branch,
  EndpointType,
  ListProjectsParams,
  ListSharedProjectsParams,
  GetProjectBranchSchemaComparisonParams,
  Organization,
  ProjectCreateRequest,
} from '@neondatabase/api-client';
import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';
import { InvalidArgumentError, NotFoundError } from '../server/errors.js';

import { describeTable, formatTableDescription } from '../describeUtils.js';
import { handleProvisionNeonAuth } from './handlers/neon-auth.js';
import { getMigrationFromMemory, persistMigrationToMemory } from './state.js';

import {
  DESCRIBE_DATABASE_STATEMENTS,
  getDefaultDatabase,
  splitSqlStatements,
  getOrgByOrgIdOrDefault,
  filterOrganizations,
  resolveBranchId,
} from './utils.js';
import { startSpan } from '@sentry/node';
import { ToolHandlerExtraParams, ToolHandlers } from './types.js';

async function handleListProjects(
  params: ListProjectsParams,
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
) {
  const organization = await getOrgByOrgIdOrDefault(params, neonClient, extra);

  const response = await neonClient.listProjects({
    ...params,
    org_id: organization?.id,
  });
  if (response.status !== 200) {
    throw new Error(`Failed to list projects: ${response.statusText}`);
  }

  let projects = response.data.projects;

  // If search is provided and no org_id specified, and no projects found in personal account,
  // search across all user organizations
  if (params.search && !params.org_id && projects.length === 0) {
    const organizations = await handleListOrganizations(
      neonClient,
      extra.account,
    );

    // Search projects across all organizations
    const allProjects = [];
    for (const org of organizations) {
      // Skip the default organization
      if (organization?.id === org.id) {
        continue;
      }

      const orgResponse = await neonClient.listProjects({
        ...params,
        org_id: org.id,
      });
      if (orgResponse.status === 200) {
        allProjects.push(...orgResponse.data.projects);
      }
    }

    // If we found projects in other organizations, return them
    if (allProjects.length > 0) {
      projects = allProjects;
    }
  }

  return projects;
}

async function handleCreateProject(
  params: ProjectCreateRequest,
  neonClient: Api<unknown>,
) {
  const response = await neonClient.createProject(params);
  if (response.status !== 201) {
    throw new Error(`Failed to create project: ${JSON.stringify(response)}`);
  }
  return response.data;
}

async function handleDeleteProject(
  projectId: string,
  neonClient: Api<unknown>,
) {
  const response = await neonClient.deleteProject(projectId);
  if (response.status !== 200) {
    throw new Error(`Failed to delete project: ${response.statusText}`);
  }
  return response.data;
}

async function handleDescribeProject(
  projectId: string,
  neonClient: Api<unknown>,
) {
  const projectBranches = await neonClient.listProjectBranches({
    projectId: projectId,
  });
  const projectDetails = await neonClient.getProject(projectId);
  if (projectBranches.status !== 200) {
    throw new Error(
      `Failed to get project branches: ${projectBranches.statusText}`,
    );
  }
  if (projectDetails.status !== 200) {
    throw new Error(`Failed to get project: ${projectDetails.statusText}`);
  }
  return {
    branches: projectBranches.data,
    project: projectDetails.data,
  };
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

    // If in read-only mode, wrap the query in a read-only transaction
    if (extra.readOnly) {
      const response = await runQuery.transaction([
        runQuery.query('SET TRANSACTION READ ONLY'),
        runQuery.query(sql),
      ]);
      // Return only the second result (the actual query result)
      return response[1];
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

  // If in read-only mode, prepend SET TRANSACTION READ ONLY
  if (extra.readOnly) {
    const response = await runQuery.transaction([
      runQuery.query('SET TRANSACTION READ ONLY'),
      ...sqlStatements.map((sql) => runQuery.query(sql)),
    ]);
    // Return all results except the first one (which is the SET command)
    return response.slice(1);
  }

  const response = await runQuery.transaction(
    sqlStatements.map((sql) => runQuery.query(sql)),
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

  // Extract table name without schema if schema-qualified
  const tableNameParts = tableName.split('.');
  const simpleTableName = tableNameParts[tableNameParts.length - 1];

  const description = await describeTable(
    connectionString.uri,
    simpleTableName,
  );
  return {
    raw: description,
    formatted: formatTableDescription(description),
  };
}

async function handleCreateBranch(
  {
    projectId,
    branchName,
  }: {
    projectId: string;
    branchName?: string;
  },
  neonClient: Api<unknown>,
) {
  const response = await neonClient.createProjectBranch(projectId, {
    branch: {
      name: branchName,
    },
    endpoints: [
      {
        type: EndpointType.ReadWrite,
        autoscaling_limit_min_cu: 0.25,
        autoscaling_limit_max_cu: 0.25,
        provisioner: 'k8s-neonvm',
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

async function handleResetFromParent(
  {
    projectId,
    branchIdOrName,
    preserveUnderName,
  }: {
    projectId: string;
    branchIdOrName: string;
    preserveUnderName?: string;
  },
  neonClient: Api<unknown>,
) {
  // Resolve branch name or ID to actual branch ID and get all branches in one call
  const { branchId: resolvedBranchId, branches } = await resolveBranchId(
    branchIdOrName,
    projectId,
    neonClient,
  );

  const branch = branches.find((b) => b.id === resolvedBranchId);
  if (!branch) {
    throw new NotFoundError(
      `Branch "${branchIdOrName}" not found in project ${projectId}`,
    );
  }

  // Find the parent branch and validate it exists
  const parentBranch = branch.parent_id
    ? branches.find((b) => b.id === branch.parent_id)
    : undefined;

  if (!parentBranch) {
    throw new InvalidArgumentError(
      `Branch "${branchIdOrName}" does not have a parent branch and cannot be reset`,
    );
  }

  // Check if the branch has children
  const hasChildren = branches.some((b) => b.parent_id === resolvedBranchId);

  // Auto-generate preserve name if branch has children and none was provided
  let finalPreserveName = preserveUnderName;
  if (hasChildren && !preserveUnderName) {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, -5);
    finalPreserveName = `${branch.name}_old_${timestamp}`;
  }

  // Call the restoreProjectBranch API
  const response = await neonClient.restoreProjectBranch(
    projectId,
    resolvedBranchId,
    {
      source_branch_id: parentBranch.id,
      preserve_under_name: finalPreserveName,
    },
  );

  return {
    ...response.data,
    preservedBranchName: finalPreserveName,
    parentBranch,
  };
}

async function handleGetConnectionString(
  {
    projectId,
    branchId,
    computeId,
    databaseName,
    roleName,
  }: {
    projectId?: string;
    branchId?: string;
    computeId?: string;
    databaseName?: string;
    roleName?: string;
  },
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
) {
  return await startSpan(
    {
      name: 'get_connection_string',
    },
    async () => {
      // If projectId is not provided, get the first project but only if there is only one project
      if (!projectId) {
        const projects = await handleListProjects({}, neonClient, extra);
        if (projects.length === 1) {
          projectId = projects[0].id;
        } else {
          throw new NotFoundError(
            'Please provide a project ID or ensure you have only one project in your account.',
          );
        }
      }

      if (!branchId) {
        const branches = await neonClient.listProjectBranches({
          projectId,
        });
        const defaultBranch = branches.data.branches.find(
          (branch) => branch.default,
        );
        if (defaultBranch) {
          branchId = defaultBranch.id;
        } else {
          throw new NotFoundError(
            'No default branch found in this project. Please provide a branch ID.',
          );
        }
      }

      // If databaseName is not provided, use default `neondb` or first database
      let dbObject;
      if (!databaseName) {
        dbObject = await getDefaultDatabase(
          {
            projectId,
            branchId,
            databaseName,
          },
          neonClient,
        );
        databaseName = dbObject.name;

        if (!roleName) {
          roleName = dbObject.owner_name;
        }
      } else if (!roleName) {
        const { data } = await neonClient.getProjectBranchDatabase(
          projectId,
          branchId,
          databaseName,
        );
        roleName = data.database.owner_name;
      }

      // Get connection URI with the provided parameters
      const connectionString = await neonClient.getConnectionUri({
        projectId,
        role_name: roleName,
        database_name: databaseName,
        branch_id: branchId,
        endpoint_id: computeId,
      });

      return {
        uri: connectionString.data.uri,
        projectId,
        branchId,
        databaseName,
        roleName,
        computeId,
      };
    },
  );
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
    const newBranch = await handleCreateBranch({ projectId }, neonClient);

    if (!databaseName) {
      const dbObject = await getDefaultDatabase(
        {
          projectId,
          branchId: newBranch.branch.id,
          databaseName,
        },
        neonClient,
      );
      databaseName = dbObject.name;
    }

    const result = await handleRunSqlTransaction(
      {
        sqlStatements: splitSqlStatements(migrationSql),
        databaseName,
        projectId,
        branchId: newBranch.branch.id,
      },
      neonClient,
      extra,
    );

    const migrationId = crypto.randomUUID();
    span.setAttributes({
      projectId,
      migrationId,
    });
    persistMigrationToMemory(migrationId, {
      migrationSql,
      databaseName,
      appliedBranch: newBranch.branch,
    });

    return {
      branch: newBranch.branch,
      migrationId,
      migrationResult: result,
    };
  });
}

async function handleCommitMigration(
  { migrationId }: { migrationId: string },
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
) {
  return await startSpan({ name: 'commit_schema_migration' }, async (span) => {
    span.setAttributes({
      migrationId,
    });
    const migration = getMigrationFromMemory(migrationId);
    if (!migration) {
      throw new Error(`Migration not found: ${migrationId}`);
    }

    span.setAttributes({
      projectId: migration.appliedBranch.project_id,
    });
    const result = await handleRunSqlTransaction(
      {
        sqlStatements: splitSqlStatements(migration.migrationSql),
        databaseName: migration.databaseName,
        projectId: migration.appliedBranch.project_id,
        branchId: migration.appliedBranch.parent_id,
      },
      neonClient,
      extra,
    );

    await handleDeleteBranch(
      {
        projectId: migration.appliedBranch.project_id,
        branchId: migration.appliedBranch.id,
      },
      neonClient,
    );

    return {
      deletedBranch: migration.appliedBranch,
      migrationResult: result,
    };
  });
}

async function handleDescribeBranch(
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
  const response = await runQuery.transaction(
    DESCRIBE_DATABASE_STATEMENTS.map((sql) => runQuery.query(sql)),
  );

  return response;
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
            `Failed to get schema for table ${tableName}: ${(error as Error).message}`,
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
        // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
        metrics.actualRows += node['Actual Rows'];
      }

      if (node['Shared Hit Blocks'])
        // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
        metrics.bufferUsage.shared.hit += node['Shared Hit Blocks'];
      if (node['Shared Read Blocks'])
        // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
        metrics.bufferUsage.shared.read += node['Shared Read Blocks'];
      if (node['Shared Written Blocks'])
        // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
        metrics.bufferUsage.shared.written += node['Shared Written Blocks'];
      if (node['Shared Dirtied Blocks'])
        // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
        metrics.bufferUsage.shared.dirtied += node['Shared Dirtied Blocks'];

      if (node['Local Hit Blocks'])
        // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
        metrics.bufferUsage.local.hit += node['Local Hit Blocks'];
      if (node['Local Read Blocks'])
        // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
        metrics.bufferUsage.local.read += node['Local Read Blocks'];
      if (node['Local Written Blocks'])
        // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
        metrics.bufferUsage.local.written += node['Local Written Blocks'];
      if (node['Local Dirtied Blocks'])
        // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
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

async function handleListBranchComputes(
  {
    projectId,
    branchId,
  }: {
    projectId?: string;
    branchId?: string;
  },
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
) {
  // If projectId is not provided, get the first project but only if there is only one project
  if (!projectId) {
    const projects = await handleListProjects({}, neonClient, extra);
    if (projects.length === 1) {
      projectId = projects[0].id;
    } else {
      throw new InvalidArgumentError(
        'Please provide a project ID or ensure you have only one project in your account.',
      );
    }
  }

  let endpoints;
  if (branchId) {
    const response = await neonClient.listProjectBranchEndpoints(
      projectId,
      branchId,
    );
    endpoints = response.data.endpoints;
  } else {
    const response = await neonClient.listProjectEndpoints(projectId);
    endpoints = response.data.endpoints;
  }

  return endpoints.map((endpoint) => ({
    compute_id: endpoint.id,
    compute_type: endpoint.type,
    compute_size:
      endpoint.autoscaling_limit_min_cu !== endpoint.autoscaling_limit_max_cu
        ? `${endpoint.autoscaling_limit_min_cu}-${endpoint.autoscaling_limit_max_cu}`
        : endpoint.autoscaling_limit_min_cu,
    last_active: endpoint.last_active,
    ...endpoint,
  }));
}

async function handleListOrganizations(
  neonClient: Api<unknown>,
  account: ToolHandlerExtraParams['account'],
  search?: string,
): Promise<Organization[]> {
  if (account.isOrg) {
    const orgId = account.id;
    const { data } = await neonClient.getOrganization(orgId);
    return filterOrganizations([data], search);
  }

  const { data: response } = await neonClient.getCurrentUserOrganizations();
  const organizations = response.organizations || [];
  return filterOrganizations(organizations, search);
}

async function handleListSharedProjects(
  params: ListSharedProjectsParams,
  neonClient: Api<unknown>,
) {
  const response = await neonClient.listSharedProjects(params);
  return response.data.projects;
}

async function handleCompareDatabaseSchema(
  params: GetProjectBranchSchemaComparisonParams,
  neonClient: Api<unknown>,
) {
  const response = await neonClient.getProjectBranchSchemaComparison(params);
  return response.data;
}

export const NEON_HANDLERS = {
  list_projects: async ({ params }, neonClient, extra) => {
    const organization = await getOrgByOrgIdOrDefault(
      params,
      neonClient,
      extra,
    );
    const projects = await handleListProjects(
      { ...params, org_id: organization?.id },
      neonClient,
      extra,
    );
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              organization: organization
                ? {
                    name: organization.name,
                    id: organization.id,
                  }
                : undefined,
              projects,
            },
            null,
            2,
          ),
        },
      ],
    };
  },

  create_project: async ({ params }, neonClient, extra) => {
    try {
      const organization = await getOrgByOrgIdOrDefault(
        params,
        neonClient,
        extra,
      );
      const result = await handleCreateProject(
        { project: { name: params.name, org_id: organization?.id } },
        neonClient,
      );

      // Get the connection string for the newly created project
      const connectionString = await handleGetConnectionString(
        {
          projectId: result.project.id,
          branchId: result.branch.id,
          databaseName: result.databases[0].name,
        },
        neonClient,
        extra,
      );

      return {
        content: [
          {
            type: 'text',
            text: [
              `Your Neon project is created ${organization ? `in organization "${organization.name}"` : ''} and is ready.`,
              `The project_id is "${result.project.id}"`,
              `The branch name is "${result.branch.name}" (ID: ${result.branch.id})`,
              `There is one database available on this branch, called "${result.databases[0].name}",`,
              'but you can create more databases using SQL commands.',
              '',
              'Connection string details:',
              `URI: ${connectionString.uri}`,
              `Project ID: ${connectionString.projectId}`,
              `Branch ID: ${connectionString.branchId}`,
              `Database: ${connectionString.databaseName}`,
              `Role: ${connectionString.roleName}`,
              '',
              'You can use this connection string with any PostgreSQL client to connect to your Neon database.',
              'For example, with psql:',
              `psql "${connectionString.uri}"`,
            ].join('\n'),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: [
              'An error occurred while creating the project.',
              'Error details:',
              message,
              'If you have reached the Neon project limit, please upgrade your account in this link: https://console.neon.tech/app/billing',
            ].join('\n'),
          },
        ],
      };
    }
  },

  delete_project: async ({ params }, neonClient) => {
    await handleDeleteProject(params.projectId, neonClient);
    return {
      content: [
        {
          type: 'text',
          text: [
            'Project deleted successfully.',
            `Project ID: ${params.projectId}`,
          ].join('\n'),
        },
      ],
    };
  },

  describe_project: async ({ params }, neonClient) => {
    const result = await handleDescribeProject(params.projectId, neonClient);
    return {
      content: [
        {
          type: 'text',
          text: `This project is called ${result.project.project.name}.`,
        },
        {
          type: 'text',
          text: `It contains the following branches (use the describe branch tool to learn more about each branch): ${JSON.stringify(
            result.branches,
            null,
            2,
          )}`,
        },
      ],
    };
  },

  run_sql: async ({ params }, neonClient, extra) => {
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
  },

  run_sql_transaction: async ({ params }, neonClient, extra) => {
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

  describe_table_schema: async ({ params }, neonClient, extra) => {
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

  get_database_tables: async ({ params }, neonClient, extra) => {
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

  create_branch: async ({ params }, neonClient) => {
    const result = await handleCreateBranch(
      {
        projectId: params.projectId,
        branchName: params.branchName,
      },
      neonClient,
    );
    return {
      content: [
        {
          type: 'text',
          text: [
            'Branch created successfully.',
            `Project ID: ${result.branch.project_id}`,
            `Branch ID: ${result.branch.id}`,
            `Branch name: ${result.branch.name}`,
            `Parent branch: ${result.branch.parent_id}`,
          ].join('\n'),
        },
      ],
    };
  },

  prepare_database_migration: async ({ params }, neonClient, extra) => {
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
              <details>
                <migration_id>${result.migrationId}</migration_id>
                <temporary_branch>
                  <name>${result.branch.name}</name>
                  <id>${result.branch.id}</id>
                </temporary_branch>
              </details>
              <execution_result>${JSON.stringify(result.migrationResult, null, 2)}</execution_result>

              <next_actions>
              You MUST follow these steps:
                1. Test this migration using \`run_sql\` tool on branch \`${result.branch.name}\`
                2. Verify the changes meet your requirements
                3. If satisfied, use \`complete_database_migration\` with migration_id: ${result.migrationId}
              </next_actions>
            `,
        },
      ],
    };
  },

  complete_database_migration: async ({ params }, neonClient, extra) => {
    const result = await handleCommitMigration(
      {
        migrationId: params.migrationId,
      },
      neonClient,
      extra,
    );
    return {
      content: [
        {
          type: 'text',
          text: `Result: ${JSON.stringify(
            {
              deletedBranch: result.deletedBranch,
              migrationResult: result.migrationResult,
            },
            null,
            2,
          )}`,
        },
      ],
    };
  },

  describe_branch: async ({ params }, neonClient, extra) => {
    const result = await handleDescribeBranch(
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
          text: ['Database Structure:', JSON.stringify(result, null, 2)].join(
            '\n',
          ),
        },
      ],
    };
  },

  delete_branch: async ({ params }, neonClient) => {
    await handleDeleteBranch(
      {
        projectId: params.projectId,
        branchId: params.branchId,
      },
      neonClient,
    );
    return {
      content: [
        {
          type: 'text',
          text: [
            'Branch deleted successfully.',
            `Project ID: ${params.projectId}`,
            `Branch ID: ${params.branchId}`,
          ].join('\n'),
        },
      ],
    };
  },

  reset_from_parent: async ({ params }, neonClient) => {
    const result = await handleResetFromParent(
      {
        projectId: params.projectId,
        branchIdOrName: params.branchIdOrName,
        preserveUnderName: params.preserveUnderName,
      },
      neonClient,
    );

    const parentInfo = `${result.parentBranch.name} (${result.parentBranch.id})`;

    const messages = [
      'Branch reset from parent successfully.',
      `Project: ${params.projectId}`,
      `Branch:  ${params.branchIdOrName}`,
      `Reset to parent branch: ${parentInfo}`,
    ];

    if (result.preservedBranchName) {
      messages.push(
        params.preserveUnderName
          ? `Previous state preserved as: ${params.preserveUnderName}`
          : `Previous state auto-preserved as: ${result.preservedBranchName} (branch had children)`,
      );
    } else {
      messages.push('Previous state was not preserved');
    }

    return {
      content: [
        {
          type: 'text',
          text: messages.join('\n'),
        },
      ],
    };
  },

  get_connection_string: async ({ params }, neonClient, extra) => {
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

  provision_neon_auth: async ({ params }, neonClient) => {
    const result = await handleProvisionNeonAuth(
      {
        projectId: params.projectId,
        database: params.database,
      },
      neonClient,
    );
    return result;
  },

  explain_sql_statement: async ({ params }, neonClient, extra) => {
    const result = await handleExplainSqlStatement(
      { params },
      neonClient,
      extra,
    );
    return result;
  },

  prepare_query_tuning: async ({ params }, neonClient, extra) => {
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

  complete_query_tuning: async ({ params }, neonClient, extra) => {
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

  list_slow_queries: async ({ params }, neonClient, extra) => {
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

  list_branch_computes: async ({ params }, neonClient, extra) => {
    const result = await handleListBranchComputes(
      {
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

  list_organizations: async ({ params }, neonClient, extra) => {
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

  list_shared_projects: async ({ params }, neonClient) => {
    const sharedProjects = await handleListSharedProjects(params, neonClient);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              shared_projects: sharedProjects,
              count: sharedProjects.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  },

  compare_database_schema: async ({ params }, neonClient) => {
    const result = await handleCompareDatabaseSchema(
      {
        projectId: params.projectId,
        branchId: params.branchId,
        db_name: params.databaseName,
      },
      neonClient,
    );
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  },
} satisfies ToolHandlers;
