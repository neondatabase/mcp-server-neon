import { log } from 'console';
import { neon } from '@neondatabase/serverless';
import { neonClient } from './index.js';
const NEON_ROLE_NAME = 'neondb_owner';
export const NEON_TOOLS = [
    {
        name: 'list_projects',
        description: `List all Neon projects in your account.`,
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'create_project',
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
        name: 'delete_project',
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
        name: 'run_sql',
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
                    description: 'An optional ID of the branch to execute the query against',
                },
            },
            required: ['sql', 'databaseName', 'projectId'],
        },
    },
    {
        name: 'get_database_tables',
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
        name: 'create_branch',
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
];
async function handleListProjects() {
    log('Executing list_projects');
    const response = await neonClient.listProjects({});
    if (response.status !== 200) {
        throw new Error(`Failed to list projects: ${response.statusText}`);
    }
    return response.data.projects;
}
async function handleCreateProject(name) {
    log('Executing create_project');
    const response = await neonClient.createProject({
        project: { name },
    });
    if (response.status !== 201) {
        throw new Error(`Failed to create project: ${response.statusText}`);
    }
    return response.data;
}
async function handleDeleteProject(projectId) {
    log('Executing delete_project');
    const response = await neonClient.deleteProject(projectId);
    if (response.status !== 200) {
        throw new Error(`Failed to delete project: ${response.statusText}`);
    }
    return response.data;
}
async function handleRunSql(sql, databaseName, projectId, branchId) {
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
async function handleGetDatabaseTables({ projectId, databaseName, branchId, }) {
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
async function handleCreateBranch({ projectId, branchName, }) {
    log('Executing create_branch');
    const response = await neonClient.createProjectBranch(projectId, {
        branch: {
            name: branchName,
        },
    });
    if (response.status !== 201) {
        throw new Error(`Failed to create branch: ${response.statusText}`);
    }
    return response.data;
}
export const NEON_HANDLERS = {
    list_projects: async (request) => {
        const projects = await handleListProjects();
        return {
            toolResult: {
                content: [{ type: 'text', text: JSON.stringify(projects, null, 2) }],
            },
        };
    },
    create_project: async (request) => {
        const { name } = request.params.arguments;
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
        const { projectId } = request.params.arguments;
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
            .arguments;
        const result = await handleRunSql(sql, databaseName, projectId, branchId);
        return {
            toolResult: {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            },
        };
    },
    get_database_tables: async (request) => {
        const { projectId, branchId, databaseName } = request.params.arguments;
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
        const { projectId, branchName } = request.params.arguments;
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
};
