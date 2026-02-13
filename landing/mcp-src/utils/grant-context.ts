/**
 * Scope categories used to annotate tool definitions.
 *
 * This file intentionally contains metadata only for PR 5.
 * Runtime grant resolution and enforcement are added in later PRs.
 */
export const SCOPE_CATEGORIES = [
  'projects',
  'branches',
  'schema',
  'querying',
  'performance',
  'neon_auth',
  'docs',
] as const;

export type ScopeCategory = (typeof SCOPE_CATEGORIES)[number];

export const SCOPE_CATEGORY_DEFINITIONS: Record<
  ScopeCategory,
  { label: string; description: string; sensitive?: boolean }
> = {
  projects: {
    label: 'Project Management',
    description:
      'Create, delete, list, and search Neon projects and organizations across your account.',
  },
  branches: {
    label: 'Branch Management',
    description:
      'Create, delete, and manage database branches for development, testing, or migrations.',
  },
  schema: {
    label: 'Schema and Table Inspection',
    description:
      'List tables and inspect schema definitions to understand your database structure.',
  },
  querying: {
    label: 'SQL Query Execution',
    description:
      'Execute SQL queries, transactions, and database migrations against your databases.',
    sensitive: true,
  },
  performance: {
    label: 'Query Performance Optimization',
    description:
      'Analyze slow queries and test performance optimizations on temporary branches.',
  },
  neon_auth: {
    label: 'Neon Auth',
    description:
      'Provision authentication infrastructure by integrating with Auth providers.',
  },
  docs: {
    label: 'Documentation and Resources',
    description: 'Access Neon documentation, setup guides, and best practices.',
  },
};
