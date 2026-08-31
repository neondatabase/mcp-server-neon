import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Api } from '../neon-client';
import type { AuthContext } from '../types/auth';
import type { ClientApplication } from '../utils/client-application';

export type ToolHandlerExtraParams = {
  account: AuthContext['extra']['account'];
  readOnly?: AuthContext['extra']['readOnly'];
  clientApplication: ClientApplication;
  apiKey?: string;
  signal?: AbortSignal;
};

export type ToolHandlerExtended = (
  args?: { params: Record<string, unknown> },
  neonClient?: Api<unknown>,
  extra?: ToolHandlerExtraParams,
) => CallToolResult | Promise<CallToolResult>;

export type ToolHandlers = Record<string, ToolHandlerExtended>;
