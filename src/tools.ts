import {
  CallToolRequest,
  Result,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { log } from 'console';
import { getNeonClient } from './utils.js';
import { neon } from '@neondatabase/serverless';

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
] satisfies Array<Tool>;
export type NeonToolName = (typeof NEON_TOOLS)[number]['name'];
type ToolHandlers = {
  [K in NeonToolName]: (request: CallToolRequest) => Promise<Result>;
};

async function handleListProjects() {
  log('Executing list_projects');
  const response = await getNeonClient().listProjects({});
  if (response.status !== 200) {
    throw new Error(`Failed to list projects: ${response.statusText}`);
  }
  return response.data.projects;
}

async function handleCreateProject(name?: string) {
  log('Executing create_project');
  const response = await getNeonClient().createProject({
    project: { name },
  });
  if (response.status !== 201) {
    throw new Error(`Failed to create project: ${response.statusText}`);
  }
  return response.data;
}

async function handleDeleteProject(projectId: string) {
  log('Executing delete_project');
  const response = await getNeonClient().deleteProject(projectId);
  if (response.status !== 200) {
    throw new Error(`Failed to delete project: ${response.statusText}`);
  }
  return response.data;
}

async function handleRunSql(
  sql: string,
  databaseName: string,
  projectId: string,
  branchId?: string,
) {
  log('Executing run_sql');

  const connectionString = await getNeonClient().getConnectionUri({
    projectId,
    role_name: 'neondb_owner',
    database_name: databaseName,
    branch_id: branchId,
  });
  const runQuery = neon(connectionString.data.uri);
  const response = await runQuery(sql);

  return response;
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
    const result = await handleRunSql(sql, databaseName, projectId, branchId);
    return {
      toolResult: {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      },
    };
  },
};

/**
 * List all Neon projects in your account.
 * Each Project in the response contains multiple branches.
 * Use the 'list_branch_databases' tool to find out all available databases on each branch.
 */
