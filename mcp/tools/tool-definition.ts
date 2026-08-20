import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { ZodTypeAny as Zod3Type } from 'zod/v3';
import type { ZodType as Zod4Type } from 'zod';
import type { ScopeCategory } from '../utils/grant-context';

export type ToolInputSchema = Zod3Type | Zod4Type;

export type NeonTool = {
  kind: 'host' | 'generated';
  name: string;
  scope: ScopeCategory | null;
  description: string;
  inputSchema: ToolInputSchema;
  readOnlySafe: boolean;
  projectScoped: boolean;
  annotations: ToolAnnotations;
};
