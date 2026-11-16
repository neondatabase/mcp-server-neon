import type { CallToolResult } from '@modelcontextprotocol/server';
import { Cause, Effect, Exit, Option } from 'effect';
import { mcpRuntime } from '../../lib/effect/runtime';
import { thrownError } from '../tools/tools';
import type { ToolCallError } from '../tools/types';
import type { IdentifiedClient } from '../utils/client-application';
import { cancelledToolResult, handleToolError, isServerError } from './errors';

export type ToolCallOutcome = {
  readonly result: CallToolResult;
  /** `client-error` and `server-error` results were rendered from a failure. */
  readonly kind: 'success' | 'client-error' | 'server-error';
};

type ToolErrorReport = {
  properties: Record<string, string>;
  traceId: string;
  agent: IdentifiedClient;
};

const renderFailure = (
  cause: Cause.Cause<ToolCallError>,
  { properties, traceId, agent }: ToolErrorReport,
): Effect.Effect<ToolCallOutcome, ToolCallError> => {
  if (Cause.hasInterruptsOnly(cause)) {
    return Effect.failCause(cause);
  }

  const thrown = Option.match(Cause.findErrorOption(cause), {
    onNone: () => Cause.squash(cause),
    onSome: thrownError,
  });

  return Effect.annotateCurrentSpan(
    'error.type',
    thrown instanceof Error ? thrown.name : 'unknown',
  ).pipe(
    Effect.map(
      (): ToolCallOutcome => ({
        result: handleToolError(thrown, properties, traceId, agent),
        kind: isServerError(thrown) ? 'server-error' : 'client-error',
      }),
    ),
  );
};

/**
 * Runs a tool handler and renders a failure the way clients have always seen
 * it. A server error is logged and sent to Sentry here, inside the tool span.
 */
export const renderToolCall = (
  handler: Effect.Effect<CallToolResult, ToolCallError>,
  report: ToolErrorReport,
): Effect.Effect<ToolCallOutcome> =>
  handler.pipe(
    Effect.map((result): ToolCallOutcome => ({ result, kind: 'success' })),
    Effect.catchCause((cause) => renderFailure(cause, report)),
    Effect.orDie,
  );

/**
 * Runs a tool callback. Aborting `signal` interrupts it, which cancels the
 * upstream request; a failure outside the handler rejects like it always has.
 */
export const runToolCallback = async (
  callback: Effect.Effect<CallToolResult>,
  signal: AbortSignal,
): Promise<CallToolResult> => {
  const exit = await mcpRuntime.runPromiseExit(callback, { signal });

  if (Exit.isSuccess(exit)) {
    return exit.value;
  }

  if (Cause.hasInterruptsOnly(exit.cause)) {
    return cancelledToolResult();
  }

  throw Cause.squash(exit.cause);
};
