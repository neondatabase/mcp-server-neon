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

This tool copies the parent at head. For a point in time, create the branch here first, then call \`restore_snapshot\` with \`target_branch_id\` set to the new branch, plus a snapshot or source point. Calling \`restore_snapshot\` without a target creates a new branch.

If the API omits a connection URI (parent with more than one role or database), the branch may already exist and the error has no id. Call \`list_branches\` before retrying.`;

const DELETE_PROJECT_DESCRIPTION = `Delete a Neon project and all its data. NEVER run autonomously; always ask the user first. For removing single branches, use \`delete_branch\` instead.

Arguments: \`{ "project_id": "…" }\`.`;

const DELETE_BRANCH_DESCRIPTION = `Delete a branch and all its data. NEVER run autonomously; always ask the user first. For deleting an entire project, use \`delete_project\` instead.

Arguments: \`{ "project_id": "…", "branch_id": "br-…" }\`. \`branch_id\` is a branch id, not a name.`;

const CREATE_PROJECT_ENDPOINT_DESCRIPTION = `Creates a compute endpoint on a branch.

This tool does not return a connection string. After it succeeds, call \`get_connection_string\` with the project and branch id to obtain a DATABASE_URL.`;

const BRANCH_ID_NOTE =
  'branch_id is a branch id (br-...), not a branch name. Call list_branches to resolve a name.';

const WAIT = { timeoutMs: 120_000 } as const;

const CREATE_TOOLS = new Set<GeneratedToolId>([
  'projects.createAndConnect',
  'branches.createWithCompute',
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
      'projects.createAndConnect': CREATE_PROJECT_DESCRIPTION,
      'branches.createWithCompute': CREATE_BRANCH_DESCRIPTION,
      'projects.delete': DELETE_PROJECT_DESCRIPTION,
      'branches.delete': DELETE_BRANCH_DESCRIPTION,
      'postgres.endpoints.create': CREATE_PROJECT_ENDPOINT_DESCRIPTION,
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
