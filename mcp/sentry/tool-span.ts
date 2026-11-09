import { startSpan, type Span } from '@sentry/node';
import type {
  CallToolResult,
  ServerContext as McpServerContext,
} from '@modelcontextprotocol/server';
import { isServerError } from '../server/errors';
import type { IdentifiedClient } from '../utils/client-application';
import { conversationIdFromMeta } from '../utils/mcp-session';
import { tagRequestConversation } from './session';

const SPAN_STATUS_ERROR = 2;

// The client name is whatever the client sent; Sentry caps tags at 200 but
// not span attributes.
const CLIENT_NAME_MAX_LENGTH = 200;

// Sentry's server-side scrubbing stores any attribute whose key contains
// "auth" as [Filtered], so the auth method goes under a neutral key.
const AUTH_METHOD_ATTRIBUTE = 'mcp.caller';

export function toolSpanClientAttributes(
  agent: IdentifiedClient,
  authMethod: string,
) {
  return {
    'mcp.client.name': agent.clientName.slice(0, CLIENT_NAME_MAX_LENGTH),
    'client.application': agent.clientApplication,
    [AUTH_METHOD_ATTRIBUTE]: authMethod,
  };
}

type ToolSpanOptions = {
  toolName: string;
  ctx: McpServerContext;
  traceId: string;
};

/**
 * One span per tool call. `mcp.*` attributes follow the OpenTelemetry MCP
 * conventions that Sentry's MCP views read; existing dashboards query
 * `tool_name`.
 */
export function startToolSpan(
  { toolName, ctx, traceId }: ToolSpanOptions,
  run: (span: Span) => Promise<CallToolResult>,
): Promise<CallToolResult> {
  const conversationId = conversationIdFromMeta(ctx.mcpReq._meta);
  if (conversationId) tagRequestConversation(conversationId);
  return startSpan(
    {
      name: `tools/call ${toolName}`,
      op: 'mcp.server',
      attributes: {
        'mcp.method.name': 'tools/call',
        'mcp.tool.name': toolName,
        tool_name: toolName,
        trace_id: traceId,
        ...(conversationId && { 'gen_ai.conversation.id': conversationId }),
      },
    },
    async (span) => {
      const result = await run(span);
      span.setAttribute('mcp.tool.result.is_error', result.isError === true);
      return result;
    },
  );
}

/** Agent mistakes keep the span ok; `error.type` still records them. */
export function recordToolError(span: Span, error: unknown): void {
  span.setAttribute(
    'error.type',
    error instanceof Error ? error.name : typeof error,
  );
  if (isServerError(error)) {
    span.setStatus({ code: SPAN_STATUS_ERROR, message: 'internal_error' });
  }
}
