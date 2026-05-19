import { NextResponse } from 'next/server';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { resolveGrantFromSearchParams } from '../../../mcp-src/utils/grant-context';
import { isReadOnly } from '../../../mcp-src/utils/read-only';
import {
  getFilteredTools,
  getAccessControlNotices,
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
 *
 * Response shape:
 *   {
 *     grant: GrantContext,                  // applied grant context
 *     readOnly: boolean,                    // applied read-only mode
 *     notices?: string[],                   // present iff read-only or
 *                                           // project-scoped is active.
 *                                           // Render once per agent turn
 *                                           // rather than per-tool to avoid
 *                                           // duplicated tokens.
 *     warnings?: string[],                  // present iff access-control
 *                                           // edge cases apply.
 *     tools: Array<{
 *       name: string,
 *       title: string,
 *       scope: ScopeCategory | "global",    // "global" means available in
 *                                           // every scope category.
 *       readOnlySafe: boolean,
 *       description: string,                // does NOT carry the notices
 *                                           // suffix (see top-level
 *                                           // `notices` instead).
 *       inputSchema: JSONSchema,            // JSON Schema draft 7, produced
 *                                           // from the Zod schema.
 *     }>
 *   }
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

    // Notices are surfaced as a top-level field rather than being
    // concatenated into every tool's `description` (which is what
    // `getAvailableTools` does for the MCP-protocol path). This avoids
    // ~600 tokens of repeated content per agent turn for clients that
    // re-include tool descriptions on every turn — see issue #257.
    phase = 'get_filtered_tools';
    const tools = getFilteredTools(grant, readOnly);

    phase = 'get_access_control_notices';
    const notices = getAccessControlNotices(grant, readOnly);

    phase = 'get_access_control_warnings';
    const warnings = getAccessControlWarnings(grant, readOnly);

    phase = 'build_response_body';
    const body = {
      grant,
      readOnly,
      ...(notices.length > 0 ? { notices } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
      tools: tools.map((tool) => ({
        name: tool.name,
        title: tool.annotations?.title ?? tool.name,
        // Tools whose `scope` is `null` internally are available regardless
        // of which scope categories are granted (see `filterToolsForGrant`).
        // Map `null` → `"global"` in the public response so external
        // integrations don't have to guess whether `null` means
        // "everywhere", "scope was unset", or "scope is unknown" (#257).
        scope: tool.scope ?? 'global',
        readOnlySafe: tool.readOnlySafe,
        description: tool.description,
        // JSON Schema (draft 7) representation of the tool's input schema,
        // produced from the Zod schema via `zod-to-json-schema`. Lets
        // external integrations validate calls before dispatch — closes
        // the gap the issue called out where the description's prose
        // constraint (e.g. "min 3 chars") couldn't be enforced
        // programmatically (#257). Draft 7 is the conservative default and
        // is universally supported by JSON Schema validators.
        inputSchema: zodToJsonSchema(tool.inputSchema),
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
