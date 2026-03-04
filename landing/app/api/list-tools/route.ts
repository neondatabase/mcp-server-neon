import { NextResponse } from 'next/server';
import { resolveGrantFromHeaders } from '../../../mcp-src/utils/grant-context';
import { isReadOnly } from '../../../mcp-src/utils/read-only';
import {
  getAvailableTools,
  getAccessControlWarnings,
} from '../../../mcp-src/tools/grant-filter';
import { logger } from '../../../mcp-src/utils/logger';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers':
    'X-Neon-Scopes, X-Neon-Project-Id, X-Neon-Read-Only, x-read-only',
};

/**
 * CORS preflight handler.
 */
export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/list-tools
 *
 * Returns the list of available MCP tools based on access-control headers.
 * No authentication required — this is a stateless preview of tool visibility.
 *
 * Accepts the same X-Neon-* headers as the MCP server:
 *   - X-Neon-Scopes: comma-separated scope categories
 *   - X-Neon-Project-Id: scope to a single project
 *   - X-Neon-Read-Only / x-read-only: true | false
 */
export function GET(req: Request) {
  let phase = 'resolve_grant';
  const startedAt = Date.now();
  const requestHeaders = {
    xNeonScopes: req.headers.get('x-neon-scopes'),
    xNeonProjectId: req.headers.get('x-neon-project-id'),
    xNeonReadOnly: req.headers.get('x-neon-read-only'),
    xReadOnly: req.headers.get('x-read-only'),
  };

  try {
    const grant = resolveGrantFromHeaders(req.headers);

    phase = 'resolve_read_only';
    const readOnly = isReadOnly({
      neonHeaderValue: requestHeaders.xNeonReadOnly,
      headerValue: requestHeaders.xReadOnly,
    });

    phase = 'get_available_tools';
    const tools = getAvailableTools(grant, readOnly);

    phase = 'get_access_control_warnings';
    const warnings = getAccessControlWarnings(grant, readOnly);

    phase = 'build_response_body';
    const body = {
      grant,
      readOnly,
      ...(warnings.length > 0 ? { warnings } : {}),
      tools: tools.map((tool) => ({
        name: tool.name,
        title: tool.annotations?.title ?? tool.name,
        scope: tool.scope,
        readOnlySafe: tool.readOnlySafe,
        description: tool.description,
      })),
    };

    return NextResponse.json(body, { headers: CORS_HEADERS });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('list_tools_request_failed', {
      phase,
      durationMs,
      requestHeaders,
      errorName: err.name,
      errorMessage: err.message,
      errorStack: err.stack,
    });

    return NextResponse.json(
      {
        error: 'list_tools_failed',
        phase,
        message: err.message,
      },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
