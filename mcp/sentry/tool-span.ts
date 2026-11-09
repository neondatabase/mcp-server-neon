import { getIsolationScope, startSpan, type Span } from '@sentry/node';
import type {
  CallToolResult,
  ServerContext as McpServerContext,
} from '@modelcontextprotocol/server';
import { isServerError } from '../server/errors';
import type { IdentifiedClient } from '../utils/client-application';
import { conversationIdFromMeta, readSessionId } from '../utils/mcp-session';

const SPAN_STATUS_ERROR = 2;

type SessionAttributes = {
  'mcp.session.id'?: string;
  'gen_ai.conversation.id'?: string;
};

function sessionAttributes(ctx: McpServerContext): SessionAttributes {
  const sessionId = readSessionId(ctx.http?.req?.headers);
  const conversationId = conversationIdFromMeta(ctx.mcpReq._meta);
  return {
    ...(sessionId && { 'mcp.session.id': sessionId }),
    ...(conversationId && { 'gen_ai.conversation.id': conversationId }),
  };
}

// The client name is whatever the client sent; Sentry caps tags at 200 but
// not span attributes.
const CLIENT_NAME_MAX_LENGTH = 200;

export function toolSpanClientAttributes(
  agent: IdentifiedClient,
  authMethod: string,
) {
  return {
    'mcp.client.name': agent.clientName.slice(0, CLIENT_NAME_MAX_LENGTH),
    'client.application': agent.clientApplication,
    'auth.method': authMethod,
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
  const session = sessionAttributes(ctx);
  getIsolationScope().setAttributes(session);
  return startSpan(
    {
      name: `tools/call ${toolName}`,
      op: 'mcp.server',
      attributes: {
        'mcp.method.name': 'tools/call',
        'mcp.tool.name': toolName,
        tool_name: toolName,
        trace_id: traceId,
        ...session,
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
