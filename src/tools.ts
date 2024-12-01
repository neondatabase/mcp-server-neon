import {
  CallToolRequest,
  Result,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { log } from 'console';
import { neon } from '@neondatabase/serverless';
import { neonClient } from './index.js';
import crypto from 'crypto';
import { getMigrationFromMemory, persistMigrationToMemory } from './state.js';
import { EndpointType, Provisioner } from '@neondatabase/api-client';

const NEON_ROLE_NAME = 'neondb_owner';
export const NEON_TOOLS = [
  {
    name: 'list_projects' as const,
    description: `List all Neon projects in your account.`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'create_project' as const,
    description: 'Create a new Neon project',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'An optional name of the project to create.',
        },
      },
    },
  },
  {
    name: 'delete_project' as const,
    description: 'Delete a Neon project',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The ID of the project to delete',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'run_sql' as const,
    description: 'Execute a SQL query against a Neon database',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'The SQL query to execute' },
        databaseName: {
          type: 'string',
          description: 'The name of the database to execute the query against',
        },
        projectId: {
          type: 'string',
          description: 'The ID of the project to execute the query against',
        },
        branchId: {
          type: 'string',
          description:
            'An optional ID of the branch to execute the query against',
        },
      },
      required: ['sql', 'databaseName', 'projectId'],
    },
  },
  {
    name: 'get_database_tables' as const,
    description: 'List all tables in a database in a Neon project',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The ID of the project',
        },
        branchId: {
          type: 'string',
          description: 'An optional ID of the branch',
        },
        databaseName: {
          type: 'string',
          description: 'The name of the database',
        },
      },
      required: ['projectId', 'databaseName'],
    },
  },
  {
    name: 'create_branch' as const,
    description: 'Create a branch in a Neon project',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The ID of the project to create the branch in',
        },
        branchName: {
          type: 'string',
          description: 'An optional name for the branch',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'start_database_migration' as const,
    description: 'Start a database migration',
    inputSchema: {
      type: 'object',
      properties: {
        migrationSql: {
          type: 'string',
          description: 'The SQL to execute to create the migration',
        },
        databaseName: {
          type: 'string',
          description: 'The name of the database to execute the query against',
        },
        projectId: {
          type: 'string',
          description: 'The ID of the project to execute the query against',
        },
      },
      required: ['migrationSql', 'databaseName', 'projectId'],
    },
  },
  {
    name: 'commit_database_migration' as const,
    description: 'Commit a database migration',
    inputSchema: {
      type: 'object',
      properties: {
        migrationId: { type: 'string' },
      },
      required: ['migrationId'],
    },
  },
] satisfies Array<Tool>;
export type NeonToolName = (typeof NEON_TOOLS)[number]['name'];
type ToolHandlers = {
  [K in NeonToolName]: (request: CallToolRequest) => Promise<Result>;
};

async function handleListProjects() {
  log('Executing list_projects');
  const response = await neonClient.listProjects({});
  if (response.status !== 200) {
    throw new Error(`Failed to list projects: ${response.statusText}`);
  }
  return response.data.projects;
}

async function handleCreateProject(name?: string) {
  log('Executing create_project');
  const response = await neonClient.createProject({
    project: { name },
  });
  if (response.status !== 201) {
    throw new Error(`Failed to create project: ${response.statusText}`);
  }
  return response.data;
}

async function handleDeleteProject(projectId: string) {
  log('Executing delete_project');
  const response = await neonClient.deleteProject(projectId);
  if (response.status !== 200) {
    throw new Error(`Failed to delete project: ${response.statusText}`);
  }
  return response.data;
}

async function handleRunSql({
  sql,
  databaseName,
  projectId,
  branchId,
}: {
  sql: string;
  databaseName: string;
  projectId: string;
  branchId?: string;
}) {
  log('Executing run_sql');
  const connectionString = await neonClient.getConnectionUri({
    projectId,
    role_name: NEON_ROLE_NAME,
    database_name: databaseName,
    branch_id: branchId,
  });
  const runQuery = neon(connectionString.data.uri);
  const response = await runQuery(sql);

  return response;
}

async function handleGetDatabaseTables({
  projectId,
  databaseName,
  branchId,
}: {
  projectId: string;
  databaseName: string;
  branchId?: string;
}) {
  log('Executing get_database_tables');

  const connectionString = await neonClient.getConnectionUri({
    projectId,
    role_name: NEON_ROLE_NAME,
    database_name: databaseName,
    branch_id: branchId,
  });

  const runQuery = neon(connectionString.data.uri);
  const query = `
    SELECT 
      table_schema,
      table_name,
      table_type
    FROM information_schema.tables 
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY table_schema, table_name;
  `;

  const tables = await runQuery(query);
  return tables;
}

async function handleCreateBranch({
  projectId,
  branchName,
}: {
  projectId: string;
  branchName?: string;
}) {
  log('Executing create_branch');
  const response = await neonClient.createProjectBranch(projectId, {
    branch: {
      name: branchName,
    },
    endpoints: [
      {
        type: EndpointType.ReadWrite,
        autoscaling_limit_min_cu: 0.25,
        autoscaling_limit_max_cu: 0.25,
        provisioner: Provisioner.K8SNeonvm,
      },
    ],
  });

  if (response.status !== 201) {
    throw new Error(`Failed to create branch: ${response.statusText}`);
  }

  return response.data;
}

async function handleDeleteBranch({
  projectId,
  branchId,
}: {
  projectId: string;
  branchId: string;
}) {
  log('Executing delete_branch');
  const response = await neonClient.deleteProjectBranch(projectId, branchId);
  return response.data;
}

async function handleSchemaMigration({
  migrationSql,
  databaseName,
  projectId,
}: {
  databaseName: string;
  projectId: string;
  migrationSql: string;
}) {
  log('Executing schema_migration');
  const newBranch = await handleCreateBranch({ projectId });
  const result = await handleRunSql({
    sql: migrationSql,
    databaseName,
    projectId,
    branchId: newBranch.branch.id,
  });

  const migrationId = crypto.randomUUID();
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
}

async function handleCommitMigration({ migrationId }: { migrationId: string }) {
  log('Executing commit_migration');
  const migration = getMigrationFromMemory(migrationId);
  if (!migration) {
    throw new Error(`Migration not found: ${migrationId}`);
  }

  const result = await handleRunSql({
    sql: migration.migrationSql,
    databaseName: migration.databaseName,
    projectId: migration.appliedBranch.project_id,
    branchId: migration.appliedBranch.parent_id,
  });

  await handleDeleteBranch({
    projectId: migration.appliedBranch.project_id,
    branchId: migration.appliedBranch.id,
  });

  return {
    migrationResult: result,
  };
}

export const NEON_HANDLERS: ToolHandlers = {
  list_projects: async (request) => {
    const projects = await handleListProjects();
    return {
      toolResult: {
        content: [{ type: 'text', text: JSON.stringify(projects, null, 2) }],
      },
    };
  },
  create_project: async (request) => {
    const { name } = request.params.arguments as { name?: string };
    const result = await handleCreateProject(name);

    return {
      toolResult: {
        content: [
          {
            type: 'text',
            text: [
              'Your Neon project is ready.',
              `The project_id is "${result.project.id}"`,
              `The branch name is "${result.branch.name}"`,
              `There is one database available on this branch, called "${result.databases[0].name}",`,
              'but you can create more databases using SQL commands.',
            ].join('\n'),
          },
        ],
      },
    };
  },
  delete_project: async (request) => {
    const { projectId } = request.params.arguments as { projectId: string };
    await handleDeleteProject(projectId);

    return {
      toolResult: {
        content: [
          {
            type: 'text',
            text: [
              'Project deleted successfully.',
              `Project ID: ${projectId}`,
            ].join('\n'),
          },
        ],
      },
    };
  },
  run_sql: async (request) => {
    const { sql, databaseName, projectId, branchId } = request.params
      .arguments as {
      sql: string;
      databaseName: string;
      projectId: string;
      branchId?: string;
    };
    const result = await handleRunSql({
      sql,
      databaseName,
      projectId,
      branchId,
    });
    return {
      toolResult: {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      },
    };
  },
  get_database_tables: async (request) => {
    const { projectId, branchId, databaseName } = request.params.arguments as {
      projectId: string;
      branchId: string;
      databaseName: string;
    };

    const tables = await handleGetDatabaseTables({
      projectId,
      branchId,
      databaseName,
    });

    return {
      toolResult: {
        content: [
          {
            type: 'text',
            text: JSON.stringify(tables, null, 2),
          },
        ],
      },
    };
  },
  create_branch: async (request) => {
    const { projectId, branchName } = request.params.arguments as {
      projectId: string;
      branchName?: string;
    };

    const result = await handleCreateBranch({
      projectId,
      branchName,
    });

    return {
      toolResult: {
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
      },
    };
  },
  start_database_migration: async (request) => {
    const { migrationSql, databaseName, projectId } = request.params
      .arguments as {
      migrationSql: string;
      databaseName: string;
      projectId: string;
    };

    const result = await handleSchemaMigration({
      migrationSql,
      databaseName,
      projectId,
    });

    return {
      toolResult: {
        content: [
          {
            type: 'text',
            text: [
              `Your schema has been temporarily applied to this branch: ${result.branch.name}.`,
              `Using the Run SQL tool against the new branch ${result.branch.id}, show the results to the user to make sure it looks good.`,
              `If everything looks good, show the user some details about the branch to which this was applied, and ask the user if he wants to commit this migration to the main branch.`,
              `When he confirms, call the "Commit database migration" tool using this migration ID: ${result.migrationId}.`,
              '',
              'Migration details:',
              JSON.stringify(result.migrationResult, null, 2),
            ].join('\n'),
          },
        ],
      },
    };
  },
  commit_database_migration: async (request) => {
    const { migrationId } = request.params.arguments as { migrationId: string };
    const result = await handleCommitMigration({ migrationId });

    return {
      toolResult: {
        content: [
          {
            type: 'text',
            text: [
              'The migration has been committed to the main branch and the temporary branch has been deleted.',
              `Result: ${JSON.stringify(result.migrationResult, null, 2)}`,
            ].join('\n'),
          },
        ],
      },
    };
  },
};
