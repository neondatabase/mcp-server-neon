import {
  createNeonTools,
  type NeonTool as GeneratedNeonTool,
} from '@neon/tools';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { NEON_API_HOST, NEON_DEFAULT_DATABASE_NAME } from '../../constants';
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

const CREATE_PROJECT_DESCRIPTION = `Creates a Neon project and waits until the default compute is ready.

If using a personal API key, include \`org_id\` to specify which organization to create the project in.
If using an org API key, \`org_id\` is automatically inferred from the key.
Plan limits define how many projects you can create.

You can specify a region (\`region_id\`) and Postgres version (\`pg_version\`).
Neon supports Postgres 14 through 18, with 19 rolling out to enabled regions.

This tool does not return a connection string. After it succeeds, call \`get_connection_string\` with the project id.`;

const DESCRIBE_PROJECT_DESCRIPTION = `Retrieves information about the specified project.
Returned details include the project settings, compute configuration, history retention, owner information, and current usage metrics.

This tool returns the project record only. Call \`list_branches\` for branches.`;

const QUERY_LOGS_DESCRIPTION = `Returns logs emitted by services running on the specified branch.

All supplied filters are combined with AND. \`minimum_severity\` and \`severity_text\` are independent: setting both requires a record to clear the severity floor and match the exact text.

Supply \`logql\` instead of the structured filters to run a raw LogQL expression. Combining it with any structured filter is rejected. \`limit\`, \`sort_order\`, and the time window still apply.

Give the window either as \`since\` (a duration ending at \`end_time\`, or now) or as \`start_time\`. Supplying both is rejected. If no time range is supplied, the query covers the previous hour. The maximum window is seven days. \`end_time\` is exclusive.

\`limit\` caps how many records come back in total. There is no \`cursor\` argument.

**Note**: This endpoint is currently in Private Beta.`;

const LIST_OPERATIONS_DESCRIPTION = `Retrieves a list of operations for the specified Neon project.
The number of operations returned can be large.
Operations older than 6 months may be deleted from our systems.
If you need more history than that, you should store your own history.

Omitting \`limit\` returns every remaining operation. Pass \`limit\` to cap how many come back. There is no \`cursor\` argument.`;

const RESET_FROM_PARENT_DESCRIPTION = `Reset a branch to its parent's current HEAD. Discards every change the branch has written since it diverged. NEVER run autonomously; always ask the user first.

Arguments: \`{ "project_id": "…", "branch_id": "br-…" }\`. \`preserve_under_name\` saves the current state under a new branch first and is required when the branch has children; those children move to the new branch.

This is parent HEAD only. Point-in-time restore is \`restore_snapshot\`, published when \`?category=snapshots\` is granted.`;

const COMPARE_DATABASE_SCHEMA_DESCRIPTION = `Compare one database's SQL schema on a branch to another branch. Returns \`{ "diff": "…" }\`, a unified SQL diff. Empty when the schemas match.

\`database_name\` is required. Use \`${NEON_DEFAULT_DATABASE_NAME}\` when the caller does not name a database. Omitting \`base_branch_id\` compares against the parent. \`base_branch_id\` is a branch id (\`br-...\`), not a name. Pass \`lsn\`, \`timestamp\`, \`base_lsn\`, or \`base_timestamp\` only for a point-in-time comparison.`;

const CREATE_BRANCH_DESCRIPTION = `Creates a branch with a read-write compute and waits until it is ready.

Arguments: \`{ "project_id": "…", "name": "feature-x" }\`. \`parent_id\` defaults to the project's default branch.

Pass \`no_compute: true\` to skip the endpoint. Do not combine \`no_compute\` with \`compute\`.

This tool does not return a connection string. After it succeeds, call \`get_connection_string\` with the project and branch id.

This tool copies the parent at head. Point-in-time restore is a separate tool, \`restore_snapshot\`, published when \`?category=snapshots\` is granted. After this create succeeds, pass the new branch id as \`restore_snapshot\`'s \`target_branch_id\`; omitting that target creates another branch.`;

const DELETE_PROJECT_DESCRIPTION = `Delete a Neon project and all its data. NEVER run autonomously; always ask the user first. For removing single branches, use \`delete_branch\` instead.

Arguments: \`{ "project_id": "…" }\`.`;

const DELETE_BRANCH_DESCRIPTION = `Delete a branch and all its data. NEVER run autonomously; always ask the user first. For deleting an entire project, use \`delete_project\` instead.

Arguments: \`{ "project_id": "…", "branch_id": "br-…" }\`. \`branch_id\` is a branch id, not a name.`;

const FINALIZE_BRANCH_RESTORE_DESCRIPTION = `Finalize the restore operation for a branch created from a snapshot.
This operation updates the branch so it functions as the original branch it replaced.
This includes:
  - Reassigning any computes from the original branch to the restored branch (this will restart the computes)
  - Renaming the restored branch to the original branch's name
  - Renaming the original branch so it no longer uses the original name

This operation only applies to branches created using \`restore_snapshot\` with \`finalize: false\`.`;

const CREATE_PROJECT_ENDPOINT_DESCRIPTION = `Creates a compute endpoint on a branch.

This tool does not return a connection string. After it succeeds, call \`get_connection_string\` with the project and branch id to obtain a DATABASE_URL.`;

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
      'operations.list': LIST_OPERATIONS_DESCRIPTION,
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
      openWorldHint: tool.annotations.openWorldHint ?? false,
    };
  }

  return {
    title: tool.title,
    readOnlyHint: tool.annotations.readOnlyHint,
    destructiveHint: generatedDestructiveHint(toolId, tool),
    idempotentHint: tool.annotations.idempotentHint ?? readOnlySafe,
    openWorldHint: tool.annotations.openWorldHint ?? false,
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
