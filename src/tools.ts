import {
  CallToolRequest,
  Result,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { log } from 'console';
import { getNeonClient } from './utils.js';

const LIST_PROJECT_TOOL = {
  name: 'list_projects' as const,
  description: `List all Neon projects in your account.`,
  inputSchema: {
    type: 'object',
    properties: {},
  },
} satisfies Tool;
export const NEON_TOOLS = [LIST_PROJECT_TOOL];

async function handleListProjects() {
  log('Executing list_projects');
  const response = await getNeonClient().listProjects({});
  if (response.status !== 200) {
    throw new Error(`Failed to list projects: ${response.statusText}`);
  }
  return response.data.projects;
}

export type NeonToolName = (typeof NEON_TOOLS)[number]['name'];
type ToolHandlers = Record<
  NeonToolName,
  (request: CallToolRequest) => Promise<Result>
>;
export const NEON_HANDLERS: ToolHandlers = {
  list_projects: async (request) => {
    const projects = await handleListProjects();

    return {
      toolResult: {
        content: [{ type: 'text', text: JSON.stringify(projects, null, 2) }],
      },
    };
  },
};

/**
 * List all Neon projects in your account.
 * Each Project in the response contains multiple branches.
 * Use the 'list_branch_databases' tool to find out all available databases on each branch.
 */
