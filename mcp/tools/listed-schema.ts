import { normalizeObjectSchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';
import type { NeonTool, ToolInputSchema } from './tool-definition';

export function toListedInputSchema(inputSchema: ToolInputSchema) {
  const normalizedSchema = normalizeObjectSchema(inputSchema);
  return normalizedSchema
    ? toJsonSchemaCompat(normalizedSchema, {
        strictUnions: true,
        pipeStrategy: 'input',
      })
    : { type: 'object' as const };
}

export function toListedTool(tool: NeonTool) {
  return {
    name: tool.name,
    title: tool.annotations?.title,
    description: tool.description,
    inputSchema: toListedInputSchema(tool.inputSchema),
    annotations: tool.annotations,
  };
}
