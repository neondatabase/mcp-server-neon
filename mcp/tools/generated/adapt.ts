import {
  createNeonTools,
  type NeonTool as GeneratedNeonTool,
} from '@neon/tools';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { NEON_API_HOST } from '../../constants';
import { fetchAsMcpServer } from '../../neon-client';
import type { NeonTool } from '../tool-definition';
import type { ToolHandlerExtended, ToolHandlers } from '../types';
import {
  GENERATED_OPERATION_IDS,
  GENERATED_OPERATION_SCOPES,
  PROJECT_SCOPED_OPERATION_OVERRIDES,
  READ_ONLY_SAFE_OPERATION_OVERRIDES,
  WORKFLOW_IDS,
  WORKFLOW_SCOPES,
  type GeneratedOperationId,
  type WorkflowToolId,
} from './operations';
import { sanitizeGeneratedResult } from './sanitize';

const CREATE_PROJECT_DESCRIPTION = `Creates a Neon project, waits until the default compute is ready, and returns a connection string.

If using a personal API key, include \`org_id\` to specify which organization to create the project in.
If using an org API key, \`org_id\` is automatically inferred from the key.
Plan limits define how many projects you can create.

You can specify a region (\`region_id\`) and Postgres version (\`pg_version\`).
Neon supports Postgres 14 through 18, with 19 rolling out to enabled regions.

\`pooled\` defaults to true. Set \`pooled: false\` for a direct host.

If the API omits a connection URI (more than one role or database), the project may already exist and the error has no id. Call \`list_projects\` before retrying.`;

const CREATE_BRANCH_DESCRIPTION = `Creates a branch with a read-write compute, waits until it is ready, and returns a connection string.

Arguments: \`{ "project_id": "…", "name": "feature-x" }\`. \`parent_id\` defaults to the project's default branch.

\`pooled\` defaults to true. Set \`pooled: false\` for a direct host.

If the API omits a connection URI (parent with more than one role or database), the branch may already exist and the error has no id. Call \`list_project_branches\` before retrying.`;

const DELETE_PROJECT_DESCRIPTION = `Delete a Neon project and all its data. NEVER run autonomously; always ask the user first. For removing single branches, use \`delete_branch\` instead.

Arguments: \`{ "project_id": "…" }\`.`;

const DELETE_BRANCH_DESCRIPTION = `Delete a branch and all its data. NEVER run autonomously; always ask the user first. For deleting an entire project, use \`delete_project\` instead.

Arguments: \`{ "project_id": "…", "branch_id": "br-…" }\`. \`branch_id\` is a branch id, not a name.`;

const CREATE_PROJECT_ENDPOINT_DESCRIPTION = `Creates a compute endpoint on a branch.

This tool does not return a connection string. After it succeeds, call \`get_connection_string\` with the project and branch id to obtain a DATABASE_URL.`;

const BRANCH_ID_NOTE =
  'branch_id is a branch id (br-...), not a branch name. Call list_project_branches to resolve a name.';

const GENERATED_TOOL_NAMES = {
  deleteProjectBranch: 'delete_branch',
} as const;

const WORKFLOW_TOOL_NAMES = {
  createProjectAndConnect: 'create_project',
  createBranchWithCompute: 'create_branch',
} as const;

const WORKFLOW_WAIT = { timeoutMs: 120_000 } as const;

const LOG_QUERY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const satisfies ToolAnnotations;

function createGeneratedNeonTools() {
  return createNeonTools({
    operations: GENERATED_OPERATION_IDS,
    workflows: WORKFLOW_IDS,
    baseUrl: NEON_API_HOST,
    fetch: fetchAsMcpServer,
    wait: WORKFLOW_WAIT,
    names: {
      ...GENERATED_TOOL_NAMES,
      ...WORKFLOW_TOOL_NAMES,
    },
    descriptions: {
      createProjectAndConnect: CREATE_PROJECT_DESCRIPTION,
      createBranchWithCompute: CREATE_BRANCH_DESCRIPTION,
      deleteProject: DELETE_PROJECT_DESCRIPTION,
      deleteProjectBranch: DELETE_BRANCH_DESCRIPTION,
      createProjectEndpoint: CREATE_PROJECT_ENDPOINT_DESCRIPTION,
    },
  });
}

type GeneratedTools = ReturnType<typeof createGeneratedNeonTools>;

type CachedTools = {
  host: string;
  tools: GeneratedTools;
};

let cached: CachedTools | undefined;

function getGeneratedNeonTools(): GeneratedTools {
  if (cached?.host === NEON_API_HOST) {
    return cached.tools;
  }

  const tools = createGeneratedNeonTools();
  cached = { host: NEON_API_HOST, tools };
  return tools;
}

function hasPathKey(tool: GeneratedNeonTool, key: string): boolean {
  return tool.metadata.path.includes(`{${key}}`);
}

export function generatedToolPathHas(id: string, key: string): boolean {
  const tools = getGeneratedNeonTools();
  const tool = Object.values(tools).find((candidate) => candidate.id === id);
  return tool !== undefined && hasPathKey(tool, key);
}

function generatedReadOnlySafe(
  operationId: GeneratedOperationId,
  tool: GeneratedNeonTool,
): boolean {
  if (READ_ONLY_SAFE_OPERATION_OVERRIDES.has(operationId)) {
    return true;
  }
  return tool.metadata.method === 'GET' && !tool.requiresApproval;
}

function generatedProjectScoped(
  operationId: GeneratedOperationId,
  tool: GeneratedNeonTool,
): boolean {
  const overrides: Partial<Record<GeneratedOperationId, boolean>> =
    PROJECT_SCOPED_OPERATION_OVERRIDES;
  const override = overrides[operationId];
  if (override !== undefined) {
    return override;
  }
  return hasPathKey(tool, 'project_id');
}

function generatedAnnotations(
  operationId: GeneratedOperationId,
  tool: GeneratedNeonTool,
  readOnlySafe: boolean,
): ToolAnnotations {
  if (operationId === 'queryProjectBranchLogs') {
    return {
      title: tool.title,
      ...LOG_QUERY_ANNOTATIONS,
    };
  }

  return {
    title: tool.title,
    readOnlyHint: tool.annotations.readOnlyHint,
    destructiveHint: generatedDestructiveHint(operationId, tool),
    idempotentHint: tool.annotations.idempotentHint ?? readOnlySafe,
    openWorldHint: tool.annotations.openWorldHint,
  };
}

const DESTRUCTIVE_OPERATION_PREFIX =
  /^(delete|remove|disable|restore|reset|revoke|suspend|restart|update)/i;

const DESTRUCTIVE_POST_OPERATIONS = new Set<GeneratedOperationId>([
  'finalizeRestoreBranch',
  'startAnonymization',
  'createProjectBranchAnonymized',
  'assignProjectVPCEndpoint',
  'setDefaultProjectBranch',
  'createProjectBranchFunctionDeployment',
  'presignProjectBranchBucketObject',
]);

function generatedDestructiveHint(
  operationId: GeneratedOperationId,
  tool: GeneratedNeonTool,
): boolean {
  const method = tool.metadata.method;
  if (method === 'GET') return false;
  if (method === 'DELETE' || method === 'PUT' || method === 'PATCH') {
    return true;
  }
  return (
    DESTRUCTIVE_OPERATION_PREFIX.test(operationId) ||
    DESTRUCTIVE_POST_OPERATIONS.has(operationId)
  );
}

function workflowToolDefinition(
  workflowId: WorkflowToolId,
  tool: GeneratedNeonTool,
): NeonTool {
  return {
    kind: 'generated',
    name: tool.id,
    scope: WORKFLOW_SCOPES[workflowId],
    description: tool.description,
    inputSchema: tool.inputSchema,
    readOnlySafe: false,
    projectScoped: hasPathKey(tool, 'project_id'),
    annotations: {
      title: tool.title,
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  };
}

export function createGeneratedToolDefinitions(): NeonTool[] {
  const tools = getGeneratedNeonTools();
  const operations = GENERATED_OPERATION_IDS.map((operationId) => {
    const tool = tools[operationId];
    const readOnlySafe = generatedReadOnlySafe(operationId, tool);
    const description = hasPathKey(tool, 'branch_id')
      ? `${tool.description}\n\n${BRANCH_ID_NOTE}`
      : tool.description;
    return {
      kind: 'generated' as const,
      name: tool.id,
      scope: GENERATED_OPERATION_SCOPES[operationId],
      description,
      inputSchema: tool.inputSchema,
      readOnlySafe,
      projectScoped: generatedProjectScoped(operationId, tool),
      annotations: generatedAnnotations(operationId, tool, readOnlySafe),
    };
  });
  const workflows = WORKFLOW_IDS.map((workflowId) =>
    workflowToolDefinition(workflowId, tools[workflowId]),
  );
  return [...operations, ...workflows];
}

function jsonTextResult(data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function createGeneratedToolHandlers(): ToolHandlers {
  const tools = getGeneratedNeonTools();
  const handlers: ToolHandlers = {};

  const register = (
    id: GeneratedOperationId | WorkflowToolId,
    tool: GeneratedNeonTool,
  ) => {
    const handler: ToolHandlerExtended = async (args, _neonClient, extra) => {
      if (!extra?.apiKey) {
        throw new Error(`Tool ${tool.id} requires an API key`);
      }
      const parsed = tool.inputSchema.parse(args?.params ?? {});
      const execute = tool.execute as (
        input: typeof parsed,
        context: { apiKey: string; signal?: AbortSignal },
      ) => ReturnType<typeof tool.execute>;
      const result = await execute(parsed, {
        apiKey: extra.apiKey,
        signal: extra.signal,
      });
      return jsonTextResult(sanitizeGeneratedResult(id, result.data));
    };
    handlers[tool.id] = handler;
  };

  for (const operationId of GENERATED_OPERATION_IDS) {
    register(operationId, tools[operationId]);
  }
  for (const workflowId of WORKFLOW_IDS) {
    register(workflowId, tools[workflowId]);
  }

  return handlers;
}
