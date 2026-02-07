import { NextResponse } from 'next/server';
import { resolveGrantFromHeaders } from '../../../mcp-src/utils/grant-context';
import { isReadOnly } from '../../../mcp-src/utils/read-only';
import { getAvailableTools } from '../../../mcp-src/tools/grant-filter';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers':
    'X-Neon-Preset, X-Neon-Scopes, X-Neon-Project-Id, X-Neon-Protect-Production, X-Neon-Read-Only, x-read-only',
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
 *   - X-Neon-Preset: full_access | local_development | production_use
 *   - X-Neon-Scopes: comma-separated scope categories (overrides preset to "custom")
 *   - X-Neon-Project-Id: scope to a single project
 *   - X-Neon-Protect-Production: true | branch names
 *   - X-Neon-Read-Only / x-read-only: true | false
 */
export function GET(req: Request) {
  const grant = resolveGrantFromHeaders(req.headers);

  const readOnly = isReadOnly({
    neonHeaderValue: req.headers.get('x-neon-read-only'),
    headerValue: req.headers.get('x-read-only'),
    grant,
  });

  const tools = getAvailableTools(grant, readOnly);

  const body = {
    grant,
    readOnly,
    tools: tools.map((tool) => ({
      name: tool.name,
      title: tool.annotations?.title ?? tool.name,
      scope: tool.scope,
      readOnlySafe: tool.readOnlySafe,
      description: tool.description,
    })),
  };

  return NextResponse.json(body, { headers: CORS_HEADERS });
}
