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
  type GeneratedOperationId,
} from './operations';
import { sanitizeGeneratedResult } from './sanitize';

const CREATE_PROJECT_DESCRIPTION = `Creates a Neon project within an organization.
If using a personal API key, include \`org_id\` to specify which organization to create the project in.
If using an org API key, \`org_id\` is automatically inferred from the key.
Plan limits define how many projects you can create.

This tool does not return a connection string. After it succeeds, call \`get_connection_string\` with the new project id to obtain a DATABASE_URL.

You can specify a region (\`region_id\`) and Postgres version (\`pg_version\`).
Neon supports Postgres 14 through 18, with 19 rolling out to enabled regions.`;

const BRANCH_ID_NOTE =
  'branch_id is a branch id (br-...), not a branch name. Call list_project_branches to resolve a name.';

const GENERATED_TOOL_NAMES = {
  createProjectBranch: 'create_branch',
  deleteProjectBranch: 'delete_branch',
} as const;

const LOG_QUERY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const satisfies ToolAnnotations;

function createGeneratedNeonTools() {
  return createNeonTools({
    operations: GENERATED_OPERATION_IDS,
    baseUrl: NEON_API_HOST,
    fetch: fetchAsMcpServer,
    names: GENERATED_TOOL_NAMES,
    descriptions: {
      createProject: CREATE_PROJECT_DESCRIPTION,
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

export function createGeneratedToolDefinitions(): NeonTool[] {
  const tools = getGeneratedNeonTools();
  return GENERATED_OPERATION_IDS.map((operationId) => {
    const tool = tools[operationId];
    const readOnlySafe = generatedReadOnlySafe(operationId, tool);
    const description = hasPathKey(tool, 'branch_id')
      ? `${tool.description}\n\n${BRANCH_ID_NOTE}`
      : tool.description;
    return {
      kind: 'generated',
      name: tool.id,
      scope: GENERATED_OPERATION_SCOPES[operationId],
      description,
      inputSchema: tool.inputSchema,
      readOnlySafe,
      projectScoped: generatedProjectScoped(operationId, tool),
      annotations: generatedAnnotations(operationId, tool, readOnlySafe),
    };
  });
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

  for (const operationId of GENERATED_OPERATION_IDS) {
    const tool = tools[operationId];
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
      return jsonTextResult(sanitizeGeneratedResult(operationId, result.data));
    };
    handlers[tool.id] = handler;
  }

  return handlers;
}
