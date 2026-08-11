import type { CallToolResult } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import { Api } from '../neon-client';

import { NEON_TOOLS } from './definitions';
import { AuthContext } from '../types/auth';
import { ClientApplication } from '../utils/client-application';

// Extract the tool names as a union type
type NeonToolName = (typeof NEON_TOOLS)[number]['name'];
type ToolParams<T extends NeonToolName = NeonToolName> = Extract<
  (typeof NEON_TOOLS)[number],
  { name: T }
>['inputSchema'];

export type ToolHandlerExtraParams = {
  account: AuthContext['extra']['account'];
  readOnly?: AuthContext['extra']['readOnly'];
  /** Detected client application type (e.g., 'cursor', 'claude', 'other') */
  clientApplication: ClientApplication;
};

export type ToolHandlerExtended<T extends NeonToolName> = (
  args: { params: z.output<ToolParams<T>> },
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
) => CallToolResult | Promise<CallToolResult>;

// Create a type for the tool handlers that directly maps each tool to its appropriate input schema
export type ToolHandlers = {
  [K in NeonToolName]: ToolHandlerExtended<K>;
};
