import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
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
  readOnlySafe: boolean;
  projectScoped: boolean;
  annotations: ToolAnnotations;
};
