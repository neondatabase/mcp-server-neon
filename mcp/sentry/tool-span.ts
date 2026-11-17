import { isCallToolResult } from '@modelcontextprotocol/server';
import type {
  CallToolResult,
  ServerContext as McpServerContext,
} from '@modelcontextprotocol/server';
import { Effect, Schema } from 'effect';
import type { ToolCallOutcome } from '../server/tool-call';
import type { IdentifiedClient } from '../utils/client-application';
import { conversationIdFromMeta } from '../utils/mcp-session';
import { tagRequestConversation } from './session';

// The client name is whatever the client sent; Sentry caps tags at 200 but
// not span attributes.
const CLIENT_NAME_MAX_LENGTH = 200;

export function toolSpanClientAttributes(agent: IdentifiedClient) {
  return {
    'mcp.client.name': agent.clientName.slice(0, CLIENT_NAME_MAX_LENGTH),
    'client.application': agent.clientApplication,
  };
}

type ToolSpanOptions = {
  toolName: string;
  ctx: McpServerContext;
  traceId: string;
};

// Fails the span for a server error; the result still reaches the client.
class ToolServerError extends Schema.TaggedError<
  ToolServerError,
  { readonly brand: unique symbol }
>()('ToolServerError', { result: Schema.declare(isCallToolResult) }) {}

/**
 * One span per tool call. `mcp.*` attributes follow the OpenTelemetry MCP
 * conventions that Sentry's MCP views read; existing dashboards query
 * `tool_name`. Agent mistakes and cancellations keep the span ok; `error.type`
 * still records them.
 */
export const withToolSpan =
  ({ toolName, ctx, traceId }: ToolSpanOptions) =>
  <R>(
    body: Effect.Effect<ToolCallOutcome, never, R>,
  ): Effect.Effect<CallToolResult, never, R> => {
    const conversationId = conversationIdFromMeta(ctx.mcpReq._meta);
    if (conversationId) tagRequestConversation(conversationId);
    return body.pipe(
      Effect.tap(({ result }) =>
        Effect.annotateCurrentSpan(
          'mcp.tool.result.is_error',
          result.isError === true,
        ),
      ),
      Effect.flatMap(({ result, kind }) =>
        kind === 'server-error'
          ? Effect.fail(ToolServerError.make({ result }))
          : Effect.succeed(result),
      ),
      Effect.onInterrupt(() =>
        Effect.annotateCurrentSpan({
          'error.type': 'ToolCallCancelledError',
          'mcp.tool.result.is_error': true,
        }),
      ),
      Effect.withSpan(`tools/call ${toolName}`, {
        attributes: {
          'sentry.op': 'mcp.server',
          'mcp.method.name': 'tools/call',
          'mcp.tool.name': toolName,
          tool_name: toolName,
          trace_id: traceId,
          ...(conversationId && { 'gen_ai.conversation.id': conversationId }),
        },
      }),
      Effect.catchTag('ToolServerError', ({ result }) =>
        Effect.succeed(result),
      ),
    );
  };
