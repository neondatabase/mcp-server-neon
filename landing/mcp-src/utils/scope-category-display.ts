/**
 * Display metadata for scope categories. Mirrors the names and
 * descriptions surfaced by the docs configurator at
 * https://neon.com/docs/ai/neon-mcp-server so the OAuth consent UI shows
 * the same labels users see when they generate their MCP client config.
 *
 * Kept in a tiny standalone module (no deps) so client components can
 * import the metadata without pulling in any server-side oauth code.
 */

import type { ScopeCategory } from './grant-context';

type ScopeCategoryDisplay = {
  label: string;
  description: string;
};

export const SCOPE_CATEGORY_DISPLAY: Record<
  ScopeCategory,
  ScopeCategoryDisplay
> = {
  projects: {
    label: 'Projects',
    description: 'Create and manage projects',
  },
  branches: {
    label: 'Branches',
    description: 'Create, reset, delete branches',
  },
  schema: {
    label: 'Schema',
    description: 'Tables, columns, indexes',
  },
  querying: {
    label: 'Querying',
    description: 'Run SQL and explain plans',
  },
  neon_auth: {
    label: 'Neon Auth',
    description: 'Users and sessions',
  },
  data_api: {
    label: 'Data API',
    description: 'RESTful data endpoints',
  },
  docs: {
    label: 'Docs',
    description: 'Search and fetch docs',
  },
};
