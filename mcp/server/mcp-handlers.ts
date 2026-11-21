import { Context, Effect, Layer } from 'effect';
import type { AuthenticatedAuthInfo } from '../transport/oauth-token';
import { withMcpSession } from '../utils/mcp-session';
import { withSdkCompatRiskLog } from '../utils/sdk-compat-risks';
import { createAuthenticatedMcpHandler } from './authenticated-handler';
import { createDocsOnlyMcpHandler } from './docs-only-handler';
import type { McpRequestHandler } from './mcp-request';

// No span of its own: one opened around mcp-handler becomes the parent of the
// request's tool spans, which run on the MCP runtime and outlive it when the
// response streams.
const serve = (request: Request, handler: McpRequestHandler) =>
  withSdkCompatRiskLog(request, withMcpSession(request, handler(request)));

/**
 * The MCP servers a request is handed to once it is accepted, built per
 * request with `mcp-handler`. A request's session id and SDK compatibility
 * risks are recorded around it.
 */
export class McpHandlers extends Context.Service<
  McpHandlers,
  {
    /** `?category=docs`: no account, docs tools only. */
    readonly serveDocsOnly: (input: {
      readonly request: Request;
    }) => Effect.Effect<Response>;
    /** Serves an authenticated caller's request with the tools its grant allows. */
    readonly serveAuthenticated: (input: {
      readonly request: Request;
      readonly authInfo: AuthenticatedAuthInfo;
    }) => Effect.Effect<Response>;
  }
>()('@neondatabase/mcp-server-neon/mcp/server/mcp-handlers/McpHandlers', {
  make: Effect.succeed({
    serveDocsOnly: Effect.fnUntraced(function* ({
      request,
    }: {
      readonly request: Request;
    }) {
      const handler = createDocsOnlyMcpHandler(
        request.headers.get('user-agent') ?? undefined,
      );

      return yield* serve(request, handler);
    }),
    serveAuthenticated: Effect.fnUntraced(function* ({
      request,
      authInfo,
    }: {
      readonly request: Request;
      readonly authInfo: AuthenticatedAuthInfo;
    }) {
      // mcp-handler hands `request.auth` to the SDK as `ctx.http.authInfo`.
      request.auth = authInfo;

      return yield* serve(request, createAuthenticatedMcpHandler(authInfo));
    }),
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
