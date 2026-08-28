import { normalizeObjectSchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';
import type { NeonTool, ToolInputSchema } from './tool-definition';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonSchemaUnboundedInt(value: unknown): boolean {
  return (
    value === Number.MAX_SAFE_INTEGER || value === -Number.MAX_SAFE_INTEGER
  );
}

/**
 * tools/list clients count inputSchema toward a catalog-size cap. Zod/OpenAPI
 * emit draft $schema URIs, int64 sentinel bounds, and RFC3339 regexes that
 * duplicate `format: "date-time"` — none of that is argument meaning. UUID,
 * email, and base64 `pattern`s stay.
 */
export function compactListedJsonSchema(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(compactListedJsonSchema);
  }
  if (!isPlainObject(node)) {
    return node;
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === '$schema') continue;
    if (
      (key === 'minimum' || key === 'maximum') &&
      isJsonSchemaUnboundedInt(value)
    ) {
      continue;
    }
    if (key === 'pattern' && node.format === 'date-time') continue;
    out[key] = compactListedJsonSchema(value);
  }
  return out;
}

export function toListedInputSchema(
  inputSchema: ToolInputSchema,
): Record<string, unknown> {
  const normalized = normalizeObjectSchema(inputSchema as never);
  if (!normalized) {
    return { type: 'object' };
  }

  const json = compactListedJsonSchema(
    toJsonSchemaCompat(normalized, {
      strictUnions: true,
      pipeStrategy: 'input',
    }),
  );
  if (!isPlainObject(json)) {
    return { type: 'object' };
  }
  return json;
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
