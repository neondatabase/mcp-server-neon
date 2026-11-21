import type {
  McpServer,
  ServerContext as McpServerContext,
} from '@modelcontextprotocol/server';
import type { Effect } from 'effect';
import type { McpCallbackServices } from '../../lib/effect/runtime';
import { withToolSpan } from '../sentry/tool-span';
import { inputContract } from '../tools/input-contract';
import { toolRegistration } from '../tools/registration';
import type { NeonTool } from '../tools/tool-definition';
import { generateTraceId } from '../utils/trace';
import { runToolCallback } from './tool-call';
import type { ToolCallOutcome } from './tool-call';

/** What a registered tool runs for one call, inside its `tools/call` span. */
export type ToolCall = (call: {
  readonly tool: NeonTool;
  readonly args: unknown;
  readonly ctx: McpServerContext;
  readonly traceId: string;
}) => Effect.Effect<ToolCallOutcome, never, McpCallbackServices>;

const v2ToolConfig = (tool: NeonTool) => {
  const registration = toolRegistration(tool);

  return {
    ...registration,
    inputSchema: inputContract(registration.inputSchema),
  };
};

// A stateless client cancels by closing the HTTP request; an MCP
// `notifications/cancelled` aborts `mcpReq.signal`. Either stops the upstream
// Neon API call.
const toolCallSignal = (ctx: McpServerContext): AbortSignal => {
  const httpSignal = ctx.http?.req?.signal;

  return httpSignal === undefined
    ? ctx.mcpReq.signal
    : AbortSignal.any([ctx.mcpReq.signal, httpSignal]);
};

/** Registers `tools` on `server`, each call running `call` on the MCP runtime. */
export const registerTools = (
  server: McpServer,
  tools: readonly NeonTool[],
  call: ToolCall,
): void => {
  for (const tool of tools) {
    server.registerTool(tool.name, v2ToolConfig(tool), async (args, ctx) => {
      const traceId = generateTraceId();

      return runToolCallback(
        call({ tool, args, ctx, traceId }).pipe(
          withToolSpan({ toolName: tool.name, ctx, traceId }),
        ),
        toolCallSignal(ctx),
      );
    });
  }
};
