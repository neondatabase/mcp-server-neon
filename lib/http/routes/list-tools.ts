import { Clock, Effect, Layer, Schema } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { toJSONSchema } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  getAccessControlNotices,
  getAccessControlWarnings,
  getFilteredTools,
} from '../../../mcp/tools/grant-filter';
import {
  InvalidRoleNameError,
  resolveGrantFromSearchParams,
} from '../../../mcp/utils/grant-context';
import type { NeonTool } from '../../../mcp/tools/tool-definition';
import { isReadOnly } from '../../../mcp/utils/read-only';
import { ListToolsFailed } from './list-tools-errors';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'x-read-only',
};

/** The `roleName` query parameter is not a valid Postgres role name. */
class InvalidRoleName extends Schema.TaggedError<
  InvalidRoleName,
  { readonly brand: unique symbol }
>()('InvalidRoleName', { message: Schema.String }) {}

const step = <A>(phase: string, run: () => A) =>
  Effect.try({
    try: run,
    catch: (cause) => {
      if (cause instanceof InvalidRoleNameError) {
        return InvalidRoleName.make({ message: cause.message });
      }

      const error = cause instanceof Error ? cause : new Error(String(cause));

      return ListToolsFailed.make({
        phase,
        errorName: error.name,
        errorMessage: error.message,
        errorStack: error.stack,
      });
    },
  });

const listedTool = (tool: NeonTool) => ({
  name: tool.name,
  title: tool.annotations?.title ?? tool.name,
  // `null` scope means every category grants the tool (#257).
  scope: tool.scope ?? 'global',
  readOnlySafe: tool.readOnlySafe,
  description: tool.description,
  // Neither converter accepts both Zod major versions.
  inputSchema:
    '_zod' in tool.inputSchema
      ? toJSONSchema(tool.inputSchema, { target: 'draft-7' })
      : zodToJsonSchema(tool.inputSchema),
});

// Notices are a top-level field instead of a suffix on every description, which
// clients would re-send on every turn (issue #257). A malformed `roleName` is
// the caller's mistake, answered inside the span so the span stays ok.
const listToolsResponse = Effect.fn('ListTools.body')(function* (input: {
  readonly searchParams: URLSearchParams;
  readonly readOnlyHeader: string | undefined;
}) {
  const { searchParams, readOnlyHeader } = input;

  const grant = yield* step('resolve_grant', () =>
    resolveGrantFromSearchParams(searchParams),
  ).pipe(Effect.catchTag('InvalidRoleName', Effect.succeed));

  if (grant instanceof InvalidRoleName) {
    return HttpServerResponse.jsonUnsafe(
      { error: 'invalid_request', message: grant.message },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const readOnly = yield* step('resolve_read_only', () =>
    isReadOnly({
      queryParamValue: searchParams.get('readonly'),
      headerValue: readOnlyHeader,
    }),
  );

  const tools = yield* step('get_filtered_tools', () =>
    getFilteredTools(grant, readOnly),
  );

  const notices = yield* step('get_access_control_notices', () =>
    getAccessControlNotices(grant, readOnly),
  );

  const warnings = yield* step('get_access_control_warnings', () =>
    getAccessControlWarnings(grant, readOnly),
  );

  const body = yield* step('build_response_body', () => ({
    grant,
    readOnly,
    // Absent rather than empty; JSON drops undefined fields.
    notices: notices.length > 0 ? notices : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
    tools: tools.map((tool) => listedTool(tool)),
  }));

  return HttpServerResponse.jsonUnsafe(body, { headers: CORS_HEADERS });
});

const failedResponse = Effect.fn('ListTools.failed')(function* (input: {
  readonly failure: ListToolsFailed;
  readonly startedAt: number;
}) {
  const { failure, startedAt } = input;
  const finishedAt = yield* Clock.currentTimeMillis;

  yield* Effect.logError('list_tools_request_failed').pipe(
    Effect.annotateLogs({
      phase: failure.phase,
      durationMs: finishedAt - startedAt,
      errorName: failure.errorName,
      errorMessage: failure.errorMessage,
      errorStack: failure.errorStack,
    }),
  );

  return HttpServerResponse.jsonUnsafe(
    {
      error: 'list_tools_failed',
      phase: failure.phase,
      message: failure.errorMessage,
    },
    { status: 500, headers: CORS_HEADERS },
  );
});

/**
 * GET /api/list-tools: the tools a connection would see for the grant in the
 * query (`category`, `projectId`, `readonly`, legacy `x-read-only` header).
 * No authentication.
 */
const listTools = Effect.gen(function* () {
  const startedAt = yield* Clock.currentTimeMillis;
  const request = yield* HttpServerRequest.HttpServerRequest;

  return yield* listToolsResponse({
    searchParams: new URL(request.originalUrl).searchParams,
    readOnlyHeader: request.headers['x-read-only'],
  }).pipe(
    Effect.catchTag('ListToolsFailed', (failure) =>
      failedResponse({ failure, startedAt }),
    ),
  );
}).pipe(Effect.withSpan('ListTools.get'));

export const ListToolsRoutes = Layer.mergeAll(
  HttpRouter.add('GET', '/api/list-tools', listTools),
  HttpRouter.add(
    'OPTIONS',
    '/api/list-tools',
    Effect.succeed(
      HttpServerResponse.empty({ status: 204, headers: CORS_HEADERS }),
    ),
  ),
);
