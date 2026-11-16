import {
  localhostAllowedOrigins,
  originValidationResponse,
} from '@modelcontextprotocol/server';
import { Context, Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { flushAfterResponse } from '../../../mcp/sentry/flush';
import {
  authChallengeResponse,
  authenticate,
  tokenStoreUnavailableResponse,
} from '../../../mcp/transport/auth';
import {
  InvalidRoleNameError,
  isDocsOnlyRequest,
  parseRoleNameParam,
} from '../../../mcp/utils/grant-context';
import { SERVER_HOST } from '../../config';
import { isLandingPageRequest, landingPageResponse } from '../../landing';
import { buildResourceMetadataUrlForResourceRequest } from '../../oauth/protected-resource-metadata';
import { isWellFormedOrigin } from '../../origin';

/** The MCP handlers a request is handed to once it is accepted. */
export class McpHandlers extends Context.Service<
  McpHandlers,
  {
    /** `?category=docs`: no account, docs tools only. */
    readonly serveDocsOnly: (req: Request) => Promise<Response>;
    /** Runs with `req.auth` set to the authenticated caller. */
    readonly serveAuthenticated: (req: Request) => Promise<Response>;
  }
>()('@neondatabase/mcp-server-neon/lib/http/routes/mcp/McpHandlers') {}

const ROUTE_PATHS = {
  canonicalMcp: '/api/mcp',
  canonicalSse: '/api/sse',
  canonicalMessage: '/api/message',
  legacyMcp: '/mcp',
  legacySse: '/sse',
  legacyMessage: '/message',
} as const;

const RETIRED_TRANSPORT_PATHS = [
  ROUTE_PATHS.canonicalSse,
  ROUTE_PATHS.canonicalMessage,
  ROUTE_PATHS.legacySse,
  ROUTE_PATHS.legacyMessage,
];

const JSON_RESPONSE_HEADERS = { 'Content-Type': 'application/json' } as const;

// Local development is the local-server case the spec's DNS-rebinding rule
// targets, so `next dev` only accepts its own and localhost origins.
const DEV_ALLOWED_ORIGIN_HOSTNAMES = [
  new URL(SERVER_HOST).hostname,
  ...localhostAllowedOrigins(),
].filter((hostname, index, hostnames) => hostnames.indexOf(hostname) === index);

const originRejection = (req: Request): Response | undefined => {
  if (process.env.NODE_ENV !== 'production') {
    return originValidationResponse(req, DEV_ALLOWED_ORIGIN_HOSTNAMES);
  }

  const origin = req.headers.get('origin');

  if (origin === null || isWellFormedOrigin(origin)) {
    return undefined;
  }

  return Response.json(
    {
      jsonrpc: '2.0',
      error: { code: -32_000, message: `Invalid Origin: ${origin}` },
      id: null,
    },
    { status: 403 },
  );
};

// A malformed pinned role is rejected before auth rather than ignored, so a
// typo in the connection URL cannot silently fall back to the owner role.
const invalidRoleNameResponse = (url: URL): Response | undefined => {
  try {
    parseRoleNameParam(url.searchParams);

    return undefined;
  } catch (error) {
    if (!(error instanceof InvalidRoleNameError)) {
      throw error;
    }

    return Response.json(
      { error: 'invalid_request', error_description: error.message },
      { status: 400 },
    );
  }
};

/**
 * What GET answers for this endpoint, minus the body.
 *
 * HEAD must not be forwarded to mcp-handler: its streamable-HTTP branch writes a
 * response only for GET, DELETE, and POST, so a HEAD falls through every branch
 * and the response promise never settles. The invocation then runs to the Fluid
 * Compute ceiling and Vercel answers 504 — 800 seconds of compute per probe, and
 * uptime checkers send them on a schedule.
 *
 * Mirroring GET keeps HEAD useful: probes learn the endpoint is alive, and the
 * status matches what a GET would have returned.
 */
// The streamable-HTTP transport is POST-only; GET is 405 (mcp-handler).
const headMirrorResponse = (): Response =>
  new Response(null, {
    status: 405,
    headers: { ...JSON_RESPONSE_HEADERS, Allow: 'POST' },
  });

/** Drop the body while preserving status and headers, as HEAD requires. */
const stripBody = (response: Response): Response =>
  new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });

const retiredTransportResponse = (method: string): Response => {
  const mcpUrl = new URL('/mcp', SERVER_HOST).href;

  const body =
    method === 'HEAD'
      ? null
      : JSON.stringify({
          error: 'transport_gone',
          message: `HTTP+SSE was removed. Connect to ${mcpUrl} using Streamable HTTP. Stdio-only clients can bridge it with \`npx -y mcp-remote ${mcpUrl}\`. See https://neon.com/docs/ai/neon-mcp-server#retired-sse.`,
        });

  return new Response(body, { status: 410, headers: JSON_RESPONSE_HEADERS });
};

const webRequest = HttpServerRequest.HttpServerRequest.pipe(
  Effect.flatMap((request) => HttpServerRequest.toWeb(request)),
  Effect.orDie,
);

/**
 * Authenticates the request, then answers it with `serve`. A rejected bearer
 * gets the 401 challenge MCP clients start OAuth discovery from, with the
 * resource metadata URL derived from the request; an unreadable token store
 * gets 503.
 */
const authenticated = (
  req: Request,
  resourceRequest: Request,
  serve: (req: Request) => Promise<Response>,
) =>
  authenticate(req).pipe(
    Effect.flatMap((authInfo) => {
      req.auth = authInfo;

      return Effect.promise(async () => serve(req));
    }),
    Effect.catchTags({
      McpAuthRejected: (rejection) =>
        Effect.succeed(
          authChallengeResponse(
            rejection,
            buildResourceMetadataUrlForResourceRequest(resourceRequest),
          ),
        ),
      TokenStoreUnavailable: () =>
        Effect.succeed(tokenStoreUnavailableResponse()),
    }),
  );

// HEAD is answered here rather than by either MCP handler, both of which leave
// it unanswered until the function times out. Checked before the docs-only
// bypass because that path skips auth entirely, which would otherwise let an
// anonymous HEAD probe hang.
const head = (normalizedReq: Request, req: Request, docsOnly: boolean) =>
  docsOnly
    ? Effect.succeed(headMirrorResponse())
    : authenticated(normalizedReq, req, async () => headMirrorResponse()).pipe(
        Effect.map(stripBody),
      );

const transport = Effect.gen(function* () {
  const req = yield* webRequest;
  const url = new URL(req.url);
  const rejection = originRejection(req) ?? invalidRoleNameResponse(url);

  if (rejection !== undefined) {
    return rejection;
  }

  if (isLandingPageRequest(req)) {
    return landingPageResponse(req);
  }

  // Normalize the public /mcp rewrite to its internal App Router path so OAuth
  // resource metadata and transport handling use one canonical URL.
  if (url.pathname === ROUTE_PATHS.legacyMcp) {
    url.pathname = ROUTE_PATHS.canonicalMcp;
  }

  const normalizedReq = new Request(url.toString(), req);
  const docsOnly = isDocsOnlyRequest(url.searchParams);

  if (normalizedReq.method === 'HEAD') {
    return yield* head(normalizedReq, req, docsOnly);
  }

  // Strict docs-only mode: bypass OAuth entirely so docs tools are usable
  // without an account. Only triggers when the request is exactly
  // ?category=docs (no other categories, no projectId).
  const { serveDocsOnly, serveAuthenticated } = yield* McpHandlers;

  const response = docsOnly
    ? yield* Effect.promise(async () => serveDocsOnly(normalizedReq))
    : yield* authenticated(normalizedReq, req, serveAuthenticated);

  return flushAfterResponse(response);
});

const retired = HttpServerRequest.HttpServerRequest.pipe(
  Effect.map((request) =>
    HttpServerResponse.fromWeb(retiredTransportResponse(request.method)),
  ),
);

// The router matches paths case-insensitively and collapses slashes; the
// transport answers only its exact paths, as the App Router route always did.
const exactly = <E, R>(
  path: string,
  handler: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
) =>
  HttpServerRequest.HttpServerRequest.pipe(
    Effect.flatMap((request) =>
      new URL(request.originalUrl, SERVER_HOST).pathname === path
        ? handler
        : Effect.succeed(HttpServerResponse.empty({ status: 404 })),
    ),
  );

const transportResponse = transport.pipe(
  Effect.map(HttpServerResponse.fromWeb),
);

export const McpRoutes = Layer.mergeAll(
  HttpRouter.add(
    '*',
    ROUTE_PATHS.canonicalMcp,
    exactly(ROUTE_PATHS.canonicalMcp, transportResponse),
  ),
  HttpRouter.add(
    '*',
    ROUTE_PATHS.legacyMcp,
    exactly(ROUTE_PATHS.legacyMcp, transportResponse),
  ),
  ...RETIRED_TRANSPORT_PATHS.map((path) =>
    HttpRouter.add('*', path, exactly(path, retired)),
  ),
);
