import { CLIENT_INFO_META_KEY } from '@modelcontextprotocol/server';
import type {
  McpServer,
  ServerContext as McpServerContext,
  ServerOptions,
} from '@modelcontextprotocol/server';
import { createMcpHandler } from 'mcp-handler';
import type { McpHandlerOptions } from 'mcp-handler';
import { Effect, Predicate } from 'effect';
import pkg from '../../package.json';
import { SERVER_INFO } from '../../lib/server-metadata';
import type { AppContext } from '../types/context';
import type { createSdkErrorReporter } from './sdk-errors';

/** A per-request MCP handler: `mcp-handler` behind an Effect. */
export type McpRequestHandler = (request: Request) => Effect.Effect<Response>;

export const appContext = (
  transport: AppContext['transport'] = 'stream',
): AppContext => ({
  name: 'mcp-server-neon',
  transport,
  environment: process.env.NODE_ENV ?? 'production',
  version: pkg.version,
});

/** The `clientInfo.name` a 2026-07-28 request carries in its `_meta`. */
export const requestClientName = (
  ctx: McpServerContext,
): string | undefined => {
  const envelope: unknown = ctx.mcpReq.envelope;

  if (!Predicate.hasProperty(envelope, CLIENT_INFO_META_KEY)) {
    return undefined;
  }

  const clientInfo = envelope[CLIENT_INFO_META_KEY];

  return Predicate.hasProperty(clientInfo, 'name') &&
    Predicate.isString(clientInfo.name)
    ? clientInfo.name
    : undefined;
};

type McpHandlerSetup = {
  readonly initialize: (server: McpServer) => void;
  readonly capabilities: ServerOptions['capabilities'];
  readonly instructions?: string;
  readonly onEvent: NonNullable<McpHandlerOptions['onEvent']>;
  readonly sdkErrors: ReturnType<typeof createSdkErrorReporter>;
};

/** One request's MCP server, served by `mcp-handler`. */
export const mcpHandler = ({
  initialize,
  capabilities,
  instructions,
  onEvent,
  sdkErrors,
}: McpHandlerSetup): McpRequestHandler => {
  const handle = createMcpHandler(initialize, {
    serverInfo: SERVER_INFO,
    capabilities,
    instructions,
    verboseLogs: process.env.NODE_ENV !== 'production',
    onEvent,
  });

  return (request) =>
    Effect.suspend(() => sdkErrors.settleAfter(handle(request)));
};
