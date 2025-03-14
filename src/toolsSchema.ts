import { ListProjectsParams } from '@neondatabase/api-client';
import { z } from 'zod';
import { NEON_DEFAULT_DATABASE_NAME } from './constants.js';

type ZodObjectParams<T> = z.ZodObject<{ [key in keyof T]: z.ZodType<T[key]> }>;

export const nodeVersionInputSchema = z.object({});

export const listProjectsInputSchema = z.object({
  cursor: z
    .string()
    .optional()
    .describe(
      'Specify the cursor value from the previous response to retrieve the next batch of projects.',
    ),
  limit: z
    .number()
    .optional()
    .describe(
      'Specify a value from 1 to 400 to limit number of projects in the response.',
    ),
  search: z
    .string()
    .optional()
    .describe(
      'Search by project name or id. You can specify partial name or id values to filter results.',
    ),
  org_id: z.string().optional().describe('Search for projects by org_id.'),
}) satisfies ZodObjectParams<ListProjectsParams>;

export const createProjectInputSchema = z.object({
  name: z
    .string()
    .optional()
    .describe('An optional name of the project to create.'),
});

export const deleteProjectInputSchema = z.object({
  projectId: z.string().describe('The ID of the project to delete'),
});

export const describeProjectInputSchema = z.object({
  projectId: z.string().describe('The ID of the project to describe'),
});

export const runSqlInputSchema = z.object({
  sql: z.string().describe('The SQL query to execute'),
  databaseName: z
    .string()
    .describe('The name of the database to execute the query against'),
  projectId: z
    .string()
    .describe('The ID of the project to execute the query against'),
  branchId: z
    .string()
    .optional()
    .describe('An optional ID of the branch to execute the query against'),
  roleName: z
    .string()
    .optional()
    .describe(
      'The name of the role to connect with. If not provided, the default role (usually "neondb_owner") will be used.',
    ),
});

export const runSqlTransactionInputSchema = z.object({
  sqlStatements: z.array(z.string()).describe('The SQL statements to execute'),
  databaseName: z
    .string()
    .describe('The name of the database to execute the query against'),
  projectId: z
    .string()
    .describe('The ID of the project to execute the query against'),
  branchId: z
    .string()
    .optional()
    .describe('An optional ID of the branch to execute the query against'),
  roleName: z
    .string()
    .optional()
    .describe(
      'The name of the role to connect with. If not provided, the default role (usually "neondb_owner") will be used.',
    ),
});

export const describeTableSchemaInputSchema = z.object({
  tableName: z.string().describe('The name of the table'),
  databaseName: z
    .string()
    .describe('The name of the database to get the table schema from'),
  projectId: z
    .string()
    .describe('The ID of the project to execute the query against'),
  branchId: z
    .string()
    .optional()
    .describe('An optional ID of the branch to execute the query against'),
  roleName: z
    .string()
    .optional()
    .describe(
      'The name of the role to connect with. If not provided, the default role (usually "neondb_owner") will be used.',
    ),
});

export const getDatabaseTablesInputSchema = z.object({
  projectId: z.string().describe('The ID of the project'),
  branchId: z.string().optional().describe('An optional ID of the branch'),
  databaseName: z.string().describe('The name of the database'),
  roleName: z
    .string()
    .optional()
    .describe(
      'The name of the role to connect with. If not provided, the default role (usually "neondb_owner") will be used.',
    ),
});

export const createBranchInputSchema = z.object({
  projectId: z
    .string()
    .describe('The ID of the project to create the branch in'),
  branchName: z.string().optional().describe('An optional name for the branch'),
});

export const prepareDatabaseMigrationInputSchema = z.object({
  migrationSql: z
    .string()
    .describe('The SQL to execute to create the migration'),
  databaseName: z
    .string()
    .describe('The name of the database to execute the query against'),
  projectId: z
    .string()
    .describe('The ID of the project to execute the query against'),
});

export const completeDatabaseMigrationInputSchema = z.object({
  migrationId: z.string(),
});

export const describeBranchInputSchema = z.object({
  projectId: z.string().describe('The ID of the project'),
  branchId: z.string().describe('An ID of the branch to describe'),
  databaseName: z.string().describe('The name of the database'),
  roleName: z
    .string()
    .optional()
    .describe(
      'The name of the role to connect with. If not provided, the default role (usually "neondb_owner") will be used.',
    ),
});

export const deleteBranchInputSchema = z.object({
  projectId: z.string().describe('The ID of the project containing the branch'),
  branchId: z.string().describe('The ID of the branch to delete'),
});

export const getConnectionStringInputSchema = z.object({
  projectId: z
    .string()
    .describe(
      'The ID of the project. If not provided, the only available project will be used.',
    ),
  branchId: z
    .string()
    .optional()
    .describe(
      'The ID or name of the branch. If not provided, the default branch will be used.',
    ),
  computeId: z
    .string()
    .optional()
    .describe(
      'The ID of the compute/endpoint. If not provided, the only available compute will be used.',
    ),
  databaseName: z
    .string()
    .optional()
    .describe(
      'The name of the database. If not provided, the default database (usually "neondb") will be used.',
    ),
  roleName: z
    .string()
    .optional()
    .describe(
      'The name of the role to connect with. If not provided, the default role (usually "neondb_owner") will be used.',
    ),
});

export const provisionNeonAuthInputSchema = z.object({
  projectId: z
    .string()
    .describe('The ID of the project to provision Neon Auth for'),
  database: z
    .string()
    .optional()
    .describe(
      `The database name to setup Neon Auth for. Defaults to '${NEON_DEFAULT_DATABASE_NAME}'`,
    )
    .default(NEON_DEFAULT_DATABASE_NAME),
});
