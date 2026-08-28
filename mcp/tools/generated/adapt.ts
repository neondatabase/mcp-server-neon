import {
  createNeonTools,
  type NeonTool as GeneratedNeonTool,
} from '@neon/tools';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { NEON_API_HOST } from '../../constants';
import { fetchAsMcpServer } from '../../neon-client';
import type { NeonTool } from '../tool-definition';
import type { ToolHandlerExtended, ToolHandlers } from '../types';
import { TOOL_NAMES } from './names';
import {
  GENERATED_TOOL_IDS,
  GENERATED_TOOL_SCOPES,
  PROJECT_SCOPED_TOOL_OVERRIDES,
  READ_ONLY_SAFE_TOOL_OVERRIDES,
  type GeneratedToolId,
} from './operations';
import { sanitizeGeneratedResult } from './sanitize';

const LIST_PROJECTS_DESCRIPTION = `List Neon projects you own. Returns every page. Pass limit to cap how many. There is no \`cursor\` argument.`;

const CREATE_PROJECT_DESCRIPTION = `Creates a Neon project and waits until the default compute is ready. Pass \`org_id\` with a personal API key. Does not return a connection string; call \`get_connection_string\` with the project id.`;

const DESCRIBE_PROJECT_DESCRIPTION = `Retrieves the project record (settings, compute, usage). Call \`list_branches\` for branches.`;

const QUERY_LOGS_DESCRIPTION = `Returns logs for a branch. Pass \`limit\` to cap how many. There is no \`cursor\` argument. Filters combine with AND. Pass \`logql\` instead of structured filters, not with them. Give the window as \`since\` or \`start_time\`, not both; default is the previous hour, max seven days; \`end_time\` is exclusive. Private beta; a branch without logs access returns HTTP 404 with reason "telemetry_not_enabled".`;

const LIST_OPERATIONS_DESCRIPTION = `Lists operations for a project. Omitting \`limit\` returns every remaining page. There is no \`cursor\` argument.`;

const RESET_FROM_PARENT_DESCRIPTION = `Reset a branch to its parent's current HEAD. NEVER run autonomously; always ask the user first. \`preserve_under_name\` saves the current state first and is required when the branch has children; those children move to the new branch.`;

const COMPARE_DATABASE_SCHEMA_DESCRIPTION = `Compare one database's SQL schema on a branch to another. \`database_name\` is required. Omit \`base_branch_id\` to compare against the parent; it is a branch id (\`br-...\`), not a name. Pass \`lsn\`, \`timestamp\`, \`base_lsn\`, or \`base_timestamp\` only for a point-in-time comparison.`;

const CREATE_BRANCH_DESCRIPTION = `Creates a branch with a read-write compute and waits until it is ready. Pass \`no_compute: true\` to skip the endpoint. Does not return a connection string; call \`get_connection_string\` with the project and branch id.`;

const DELETE_PROJECT_DESCRIPTION = `Delete a Neon project and all its data. NEVER run autonomously; always ask the user first. For a single branch, use \`delete_branch\`.`;

const DELETE_BRANCH_DESCRIPTION = `Delete a branch and all its data. NEVER run autonomously; always ask the user first. For the whole project, use \`delete_project\`.`;

const FINALIZE_BRANCH_RESTORE_DESCRIPTION = `Finalize a branch created with \`restore_snapshot\` and \`finalize: false\`: reassign computes and swap names so it replaces the original branch.`;

const CREATE_PROJECT_ENDPOINT_DESCRIPTION = `Creates a compute endpoint on a branch. Does not return a connection string; call \`get_connection_string\`.`;

const DEPLOY_FUNCTION_DESCRIPTION = `Creates a deployment for the function. Supply at least one of \`zip\`, \`environment\`, or \`runtime\`; omitted fields inherit the latest version. The first deployment must include \`zip\`.`;

const LIST_LOG_FIELD_VALUES_DESCRIPTION = `Lists distinct values for a low-cardinality log field. Call \`list_log_fields\` first for \`field_name\`; a field the branch has never emitted returns \`unknown_field\`. Pass \`since\` or \`start_time\`, not both; default is the previous six hours, max seven days. Private beta.`;

const BRANCH_ID_NOTE =
  'branch_id is a branch id (br-...), not a branch name. Call list_branches to resolve a name.';

const WAIT = { timeoutMs: 120_000 } as const;

const CREATE_TOOLS = new Set<GeneratedToolId>([
  'projects.create',
  'branches.create',
]);

const LOG_QUERY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const satisfies ToolAnnotations;

function createGeneratedNeonTools() {
  return createNeonTools({
    tools: GENERATED_TOOL_IDS,
    baseUrl: NEON_API_HOST,
    fetch: fetchAsMcpServer,
    wait: WAIT,
    names: TOOL_NAMES,
    descriptions: {
      'projects.list': LIST_PROJECTS_DESCRIPTION,
      'projects.create': CREATE_PROJECT_DESCRIPTION,
      'projects.get': DESCRIBE_PROJECT_DESCRIPTION,
      'branches.create': CREATE_BRANCH_DESCRIPTION,
      'branches.resetFromParent': RESET_FROM_PARENT_DESCRIPTION,
      'branches.compareSchema': COMPARE_DATABASE_SCHEMA_DESCRIPTION,
      'projects.delete': DELETE_PROJECT_DESCRIPTION,
      'branches.delete': DELETE_BRANCH_DESCRIPTION,
      'branches.finalizeRestore': FINALIZE_BRANCH_RESTORE_DESCRIPTION,
      'postgres.endpoints.create': CREATE_PROJECT_ENDPOINT_DESCRIPTION,
      'logs.query': QUERY_LOGS_DESCRIPTION,
      'logs.fieldValues': LIST_LOG_FIELD_VALUES_DESCRIPTION,
      'operations.list': LIST_OPERATIONS_DESCRIPTION,
      'functions.deploy': DEPLOY_FUNCTION_DESCRIPTION,
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
  toolId: GeneratedToolId,
  tool: GeneratedNeonTool,
): boolean {
  if (READ_ONLY_SAFE_TOOL_OVERRIDES.has(toolId)) {
    return true;
  }
  return tool.metadata.method === 'GET' && !tool.requiresApproval;
}

function generatedProjectScoped(
  toolId: GeneratedToolId,
  tool: GeneratedNeonTool,
): boolean {
  const overrides: Partial<Record<GeneratedToolId, boolean>> =
    PROJECT_SCOPED_TOOL_OVERRIDES;
  const override = overrides[toolId];
  if (override !== undefined) {
    return override;
  }
  return hasPathKey(tool, 'project_id');
}

function generatedAnnotations(
  toolId: GeneratedToolId,
  tool: GeneratedNeonTool,
  readOnlySafe: boolean,
): ToolAnnotations {
  if (toolId === 'logs.query') {
    return {
      title: tool.title,
      ...LOG_QUERY_ANNOTATIONS,
    };
  }

  if (CREATE_TOOLS.has(toolId)) {
    return {
      title: tool.title,
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    };
  }

  return {
    title: tool.title,
    readOnlyHint: tool.annotations.readOnlyHint,
    destructiveHint: generatedDestructiveHint(toolId, tool),
    idempotentHint: tool.annotations.idempotentHint ?? readOnlySafe,
    openWorldHint: tool.annotations.openWorldHint,
  };
}

const DESTRUCTIVE_SEGMENT_PREFIX =
  /^(delete|remove|disable|restore|reset|revoke|suspend|restart|update)/i;

const DESTRUCTIVE_POST_TOOLS = new Set<GeneratedToolId>([
  'branches.finalizeRestore',
  'branches.setDefault',
  'functions.deploy',
  'storage.objects.presign',
]);

function lastSegment(toolId: GeneratedToolId): string {
  const parts = toolId.split('.');
  return parts[parts.length - 1] ?? toolId;
}

function generatedDestructiveHint(
  toolId: GeneratedToolId,
  tool: GeneratedNeonTool,
): boolean {
  const method = tool.metadata.method;
  if (method === 'GET') return false;
  if (method === 'DELETE' || method === 'PUT' || method === 'PATCH') {
    return true;
  }
  return (
    DESTRUCTIVE_SEGMENT_PREFIX.test(lastSegment(toolId)) ||
    DESTRUCTIVE_POST_TOOLS.has(toolId)
  );
}

export function createGeneratedToolDefinitions(): NeonTool[] {
  const tools = getGeneratedNeonTools();
  return GENERATED_TOOL_IDS.map((toolId) => {
    const tool = tools[toolId];
    const readOnlySafe = generatedReadOnlySafe(toolId, tool);
    const description = hasPathKey(tool, 'branch_id')
      ? `${tool.description}\n\n${BRANCH_ID_NOTE}`
      : tool.description;
    return {
      kind: 'generated' as const,
      name: tool.id,
      scope: GENERATED_TOOL_SCOPES[toolId],
      description,
      inputSchema: tool.inputSchema,
      readOnlySafe,
      projectScoped: generatedProjectScoped(toolId, tool),
      annotations: generatedAnnotations(toolId, tool, readOnlySafe),
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

  for (const toolId of GENERATED_TOOL_IDS) {
    const tool = tools[toolId];
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
      return jsonTextResult(sanitizeGeneratedResult(toolId, result.data));
    };
    handlers[tool.id] = handler;
  }

  return handlers;
}
