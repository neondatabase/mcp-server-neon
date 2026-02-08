import { ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Api } from '@neondatabase/api-client';

import { NEON_TOOLS } from './definitions';
import { AuthContext } from '../types/auth';
import { ClientApplication } from '../utils/client-application';

// Extract the tool names as a union type
type NeonToolName = (typeof NEON_TOOLS)[number]['name'];
type ToolParams<T extends NeonToolName = NeonToolName> = Extract<
  (typeof NEON_TOOLS)[number],
  { name: T }
>['inputSchema'];

type ToolHandler<T extends NeonToolName> = ToolCallback<{
  params: ToolParams<T>;
}>;

export type ToolHandlerExtraParams = Parameters<
  ToolHandler<NeonToolName>
>['1'] & {
  account: AuthContext['extra']['account'];
  readOnly?: AuthContext['extra']['readOnly'];
  /** Detected client application type (e.g., 'cursor', 'claude', 'other') */
  clientApplication: ClientApplication;
};

export type ToolHandlerExtended<T extends NeonToolName> = (
  ...args: [
    args: Parameters<ToolHandler<T>>['0'],
    neonClient: Api<unknown>,
    extra: ToolHandlerExtraParams,
  ]
) => ReturnType<ToolHandler<T>>;

// Create a type for the tool handlers that directly maps each tool to its appropriate input schema
export type ToolHandlers = {
  [K in NeonToolName]: ToolHandlerExtended<K>;
};
