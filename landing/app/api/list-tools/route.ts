import { NextResponse } from 'next/server';
import { resolveGrantFromSearchParams } from '../../../mcp-src/utils/grant-context';
import { isReadOnly } from '../../../mcp-src/utils/read-only';
import {
  getAvailableTools,
  getAccessControlWarnings,
} from '../../../mcp-src/tools/grant-filter';
import { logger } from '../../../mcp-src/utils/logger';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'x-read-only',
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
 * Returns the list of available MCP tools based on URL query params.
 * No authentication required — this is a stateless preview of tool visibility.
 *
 * Accepts URL query params:
 *   - category: scope categories (repeated or comma-separated)
 *   - projectId: scope to a single project
 *   - readonly: true | false
 *   - Also supports legacy x-read-only header
 */
export function GET(req: Request) {
  let phase = 'resolve_grant';
  const startedAt = Date.now();
  const url = new URL(req.url);
  const searchParams = url.searchParams;

  try {
    const grant = resolveGrantFromSearchParams(searchParams);

    phase = 'resolve_read_only';
    const readOnly = isReadOnly({
      queryParamValue: searchParams.get('readonly'),
      headerValue: req.headers.get('x-read-only'),
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
