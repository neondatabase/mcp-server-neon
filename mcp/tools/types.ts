import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from '@modelcontextprotocol/sdk/types.js';
import type { Api } from '../neon-client';
import type { AuthContext } from '../types/auth';
import type { ClientApplication } from '../utils/client-application';

export type ToolHandlerExtraParams = RequestHandlerExtra<
  ServerRequest,
  ServerNotification
> & {
  account: AuthContext['extra']['account'];
  readOnly?: AuthContext['extra']['readOnly'];
  clientApplication: ClientApplication;
  apiKey?: string;
  /**
   * Postgres role pinned by the connection grant. Set only by `invokeTool`
   * from the grant, never from tool arguments.
   */
  pinnedRoleName?: string;
};

export type ToolHandlerExtended = (
  args?: { params: Record<string, unknown> },
  neonClient?: Api<unknown>,
  extra?: ToolHandlerExtraParams,
) => CallToolResult | Promise<CallToolResult>;

export type ToolHandlers = Record<string, ToolHandlerExtended>;
