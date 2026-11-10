import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { type NeonTool as PackageTool } from '@neon/tools';
import * as z from 'zod';
import { NEON_PACKAGE_TOOLS } from './neon-tools';
import {
  CUSTOM_TOOL_GRANTS,
  GENERATED_TOOL_SCOPES,
  isCustomToolId,
  PROJECT_SCOPED_TOOL_OVERRIDES,
  READ_ONLY_SAFE_TOOL_OVERRIDES,
  TOOL_IDS,
  type GeneratedToolId,
  type ToolId,
} from './operations';
import type { NeonTool } from './tool-definition';

export const PACKAGE_TOOLS: Record<ToolId, PackageTool> = NEON_PACKAGE_TOOLS;

const connectionStringShape =
  NEON_PACKAGE_TOOLS['postgres.connectionString'].inputSchema.shape;

/**
 * `get_connection_string` has always taken the compute as `compute_id` and has
 * never offered `pooled`, so its published schema keeps that shape.
 */
export const GET_CONNECTION_STRING_INPUT_SCHEMA = z.strictObject({
  project_id: connectionStringShape.project_id,
  branch_id: connectionStringShape.branch_id,
  compute_id: connectionStringShape.endpoint_id,
  database_name: connectionStringShape.database_name,
  role_name: connectionStringShape.role_name,
});

function hasPathKey(tool: PackageTool, key: string): boolean {
  return tool.metadata.path.includes(`{${key}}`);
}

function generatedReadOnlySafe(
  toolId: GeneratedToolId,
  tool: PackageTool,
): boolean {
  if (READ_ONLY_SAFE_TOOL_OVERRIDES.has(toolId)) {
    return true;
  }
  return tool.metadata.method === 'GET' && !tool.requiresApproval;
}

function generatedProjectScoped(
  toolId: GeneratedToolId,
  tool: PackageTool,
): boolean {
  const overrides: Partial<Record<GeneratedToolId, boolean>> =
    PROJECT_SCOPED_TOOL_OVERRIDES;
  const override = overrides[toolId];
  if (override !== undefined) {
    return override;
  }
  return hasPathKey(tool, 'project_id');
}

const LOG_QUERY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const satisfies ToolAnnotations;

const CREATE_TOOLS = new Set<GeneratedToolId>([
  'projects.create',
  'branches.create',
]);

const DESTRUCTIVE_SEGMENT_PREFIX =
  /^(delete|remove|disable|restore|reset|revoke|suspend|restart|update)/i;

const DESTRUCTIVE_POST_TOOLS = new Set<GeneratedToolId>([
  'branches.finalizeRestore',
  'branches.setDefault',
  'functions.deploy',
  'storage.objects.presign',
  'credentials.rotate',
  'realtime.rotateSecret',
  'auth.oauthClients.rotateSecret',
]);

function lastSegment(toolId: GeneratedToolId): string {
  const parts = toolId.split('.');
  return parts[parts.length - 1] ?? toolId;
}

function generatedDestructiveHint(
  toolId: GeneratedToolId,
  tool: PackageTool,
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

function generatedAnnotations(
  toolId: GeneratedToolId,
  tool: PackageTool,
  readOnlySafe: boolean,
): ToolAnnotations {
  if (toolId === 'logs.query') {
    return { title: tool.title, ...LOG_QUERY_ANNOTATIONS };
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

// `user.organizations` and `postgres.connectionString` are SDK reads whose
// package annotations leave the destructive and idempotent hints unset.
function customAnnotations(tool: PackageTool): ToolAnnotations {
  const { readOnlyHint, destructiveHint, idempotentHint, openWorldHint } =
    tool.annotations;
  return {
    title: tool.title,
    readOnlyHint,
    destructiveHint: destructiveHint ?? !readOnlyHint,
    idempotentHint: idempotentHint ?? readOnlyHint,
    openWorldHint,
  };
}

function toolDefinition(toolId: ToolId): NeonTool {
  const tool = PACKAGE_TOOLS[toolId];
  if (isCustomToolId(toolId)) {
    return {
      kind: 'custom',
      id: toolId,
      name: tool.id,
      description: tool.description,
      inputSchema:
        toolId === 'postgres.connectionString'
          ? GET_CONNECTION_STRING_INPUT_SCHEMA
          : tool.inputSchema,
      annotations: customAnnotations(tool),
      ...CUSTOM_TOOL_GRANTS[toolId],
    };
  }
  const readOnlySafe = generatedReadOnlySafe(toolId, tool);
  return {
    kind: 'generated',
    id: toolId,
    name: tool.id,
    scope: GENERATED_TOOL_SCOPES[toolId],
    description: tool.description,
    inputSchema: tool.inputSchema,
    readOnlySafe,
    projectScoped: generatedProjectScoped(toolId, tool),
    annotations: generatedAnnotations(toolId, tool, readOnlySafe),
  };
}

export const NEON_TOOLS: NeonTool[] = TOOL_IDS.map(toolDefinition);
