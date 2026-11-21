import { waitUntil } from '@vercel/functions';
import { Layer, ManagedRuntime } from 'effect';
import type { Effect } from 'effect';
import { Analytics } from '../../mcp/analytics/analytics-service';
import { NeonAccounts } from '../../mcp/server/neon-accounts';
import { SentryLayer } from '../../mcp/sentry/effect';
import { WinstonLoggerLayer } from './logger';

// The HTTP app and the MCP callbacks build their layers through this map, so a
// layer both use is built once per instance.
export const memoMap = Layer.makeMemoMapUnsafe();

/** The services MCP SDK callbacks run with. */
export const McpCallbackLayer = Layer.mergeAll(
  SentryLayer,
  WinstonLoggerLayer,
  NeonAccounts.layer,
  Analytics.layer,
);

// MCP SDK callbacks (tool calls, lifecycle hooks) run inside mcp-handler,
// outside the HTTP app's request fibers. They get the same tracer, so tool
// spans nest under the request span, and the same error reporter.
export const mcpRuntime = ManagedRuntime.make(McpCallbackLayer, { memoMap });

export type McpCallbackServices = Layer.Success<typeof McpCallbackLayer>;

/**
 * Runs `effect` after the response on the shared runtime, keeping a serverless
 * function alive until it settles. The one place work outlives its request.
 */
export const runAfterResponse = (
  effect: Effect.Effect<void, never, McpCallbackServices>,
) => {
  waitUntil(mcpRuntime.runPromise(effect));
};
