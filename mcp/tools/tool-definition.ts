import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { JsonSchemaType } from '@modelcontextprotocol/server';
import type { NeonSecretField } from '@neon/tools';
import type * as z from 'zod';
import type { ScopeCategory } from '../utils/grant-context';
import type { ToolId } from './operations';

export type ToolInputSchema = z.ZodType;

export type NeonTool = {
  kind: 'custom' | 'generated';
  id: ToolId;
  name: string;
  scope: ScopeCategory | null;
  description: string;
  inputSchema: ToolInputSchema;
  /** JSON Schema of the `structuredContent` a successful call returns. */
  outputSchema: JsonSchemaType;
  readOnlySafe: boolean;
  returnsOnlySecrets: boolean;
  secretOutputFields: readonly NeonSecretField[];
  projectScoped: boolean;
  annotations: ToolAnnotations;
};
