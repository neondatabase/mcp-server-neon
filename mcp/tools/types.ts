import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { NeonToolError } from '@neon/tools/effect';
import type { Effect } from 'effect';
import type { NeonSecretsMode } from '@neon/tools';
import type {
  InternalToolError,
  InvalidArgumentError,
  NotFoundError,
} from '../server/errors';
import type { NeonAccounts } from '../server/neon-accounts';
import type { AuthContext } from '../types/auth';
import type { ClientApplication } from '../utils/client-application';
import type { ToolStepFailed } from './errors';

export type ToolHandlerExtraParams = {
  /** Absent on the anonymous `?category=docs` endpoint. */
  account?: AuthContext['extra']['account'];
  readOnly?: AuthContext['extra']['readOnly'];
  clientApplication: ClientApplication;
  apiKey?: string;
  userAgent?: string;
  /**
   * Postgres role pinned by the connection grant. Set only by `invokeTool`
   * from the grant, never from tool arguments.
   */
  pinnedRoleName?: string;
  /** Set only by `invokeTool` from the grant and read-only mode. */
  secrets?: NeonSecretsMode;
};

export type ToolCallError =
  | NeonToolError
  | ToolStepFailed
  | InvalidArgumentError
  | NotFoundError
  | InternalToolError;

/**
 * Interrupting the handler's fiber cancels the tool call. `NeonAccounts`
 * resolves `org_id` for the project tools.
 */
export type ToolHandler = (
  args?: { params: Record<string, unknown> },
  extra?: ToolHandlerExtraParams,
) => Effect.Effect<CallToolResult, ToolCallError, NeonAccounts>;

export type ToolHandlers = Record<string, ToolHandler>;
