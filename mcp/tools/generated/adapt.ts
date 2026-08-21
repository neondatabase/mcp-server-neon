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
If using a personal API key, include \`org_id\` in the project body to specify which organization to create the project in.
If using an org API key, \`org_id\` is automatically inferred from the key.
Plan limits define how many projects you can create.

This tool does not return a connection string. After it succeeds, call \`get_connection_string\` with the new project id to obtain a DATABASE_URL.

You can specify a region and Postgres version in the request body.
Neon supports Postgres 14 through 18, with 19 rolling out to enabled regions.`;

const LOG_QUERY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const satisfies ToolAnnotations;

type GeneratedTools = ReturnType<
  typeof createNeonTools<typeof GENERATED_OPERATION_IDS>
>;

type CachedTools = {
  host: string;
  tools: GeneratedTools;
};

let cached: CachedTools | undefined;

function getGeneratedNeonTools(): GeneratedTools {
  if (cached?.host === NEON_API_HOST) {
    return cached.tools;
  }

  const tools = createNeonTools({
    operations: GENERATED_OPERATION_IDS,
    baseUrl: NEON_API_HOST,
    fetch: fetchAsMcpServer,
    descriptions: {
      createProject: CREATE_PROJECT_DESCRIPTION,
    },
  });
  cached = { host: NEON_API_HOST, tools };
  return tools;
}

function hasPathProjectId(tool: GeneratedNeonTool): boolean {
  const schema = tool.inputSchema;
  if (
    !('shape' in schema) ||
    typeof schema.shape !== 'object' ||
    !schema.shape
  ) {
    return false;
  }
  const shape = schema.shape;
  if (!('path' in shape)) {
    return false;
  }
  const pathSchema = shape.path;
  if (
    typeof pathSchema !== 'object' ||
    pathSchema === null ||
    !('shape' in pathSchema) ||
    typeof pathSchema.shape !== 'object' ||
    pathSchema.shape === null
  ) {
    return false;
  }
  return 'project_id' in pathSchema.shape;
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
  return hasPathProjectId(tool);
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
    destructiveHint: tool.annotations.destructiveHint ?? !readOnlySafe,
    idempotentHint: tool.annotations.idempotentHint ?? readOnlySafe,
    openWorldHint: tool.annotations.openWorldHint,
  };
}

export function createGeneratedToolDefinitions(): NeonTool[] {
  const tools = getGeneratedNeonTools();
  return GENERATED_OPERATION_IDS.map((operationId) => {
    const tool = tools[operationId];
    const readOnlySafe = generatedReadOnlySafe(operationId, tool);
    return {
      kind: 'generated',
      name: tool.id,
      scope: GENERATED_OPERATION_SCOPES[operationId],
      description: tool.description,
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
      return jsonTextResult(sanitizeGeneratedResult(result.data));
    };
    handlers[tool.id] = handler;
  }

  return handlers;
}
