import type { CallToolResult } from '@modelcontextprotocol/server';
import { Cause, Effect, ErrorReporter, Exit, Match, Option } from 'effect';
import { mcpRuntime, runAfterResponse } from '../../lib/effect/runtime';
import type { McpCallbackServices } from '../../lib/effect/runtime';
import { flushSentry } from '../sentry/flush';
import type { ToolCallError } from '../tools/types';
import type { IdentifiedClient } from '../utils/client-application';
import {
  cancelledToolResult,
  errorResponse,
  handleToolError,
  isServerError,
} from './errors';

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

const renderedFailure = (
  errorType: string,
  render: () => ToolCallOutcome,
): Effect.Effect<ToolCallOutcome> =>
  Effect.annotateCurrentSpan('error.type', errorType).pipe(Effect.map(render));

/** Renders what a package tool or a step threw, or a defect, by its type. */
const renderThrown = (
  cause: unknown,
  { properties, traceId, agent }: ToolErrorReport,
) =>
  renderedFailure(cause instanceof Error ? cause.name : 'unknown', () => ({
    result: handleToolError(cause, properties, traceId, agent),
    kind: isServerError(cause) ? 'server-error' : 'client-error',
  }));

const renderToolCallError = (error: ToolCallError, report: ToolErrorReport) =>
  Match.value(error).pipe(
    Match.tag('InvalidArgumentError', 'NotFoundError', (clientError) =>
      renderedFailure(clientError.name, () => ({
        result: errorResponse(clientError),
        kind: 'client-error',
      })),
    ),
    Match.tag('InternalToolError', (serverError) =>
      renderedFailure(serverError.name, () => ({
        result: handleToolError(
          serverError,
          report.properties,
          report.traceId,
          report.agent,
        ),
        kind: 'server-error',
      })),
    ),
    Match.tag('ToolStepFailed', ({ error: thrown }) =>
      renderThrown(thrown, report),
    ),
    Match.tagStartsWith('Neon', ({ cause }) => renderThrown(cause, report)),
    Match.exhaustive,
  );

const renderFailure = (
  cause: Cause.Cause<ToolCallError>,
  report: ToolErrorReport,
): Effect.Effect<ToolCallOutcome, ToolCallError> => {
  if (Cause.hasInterruptsOnly(cause)) {
    return Effect.failCause(cause);
  }

  return Option.match(Cause.findErrorOption(cause), {
    onNone: () => renderThrown(Cause.squash(cause), report),
    onSome: (error) => renderToolCallError(error, report),
  });
};

/**
 * Runs a tool handler and renders a failure the way clients have always seen
 * it. A server error is logged and sent to Sentry here, inside the tool span.
 */
export const renderToolCall = <R>(
  handler: Effect.Effect<CallToolResult, ToolCallError, R>,
  report: ToolErrorReport,
): Effect.Effect<ToolCallOutcome, never, R> =>
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
  callback: Effect.Effect<CallToolResult, never, McpCallbackServices>,
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

/**
 * Runs the Effect behind an MCP SDK callback that returns nothing, such as a
 * lifecycle hook, which can outlive its request. A defect there goes to Sentry;
 * an error the callback reported itself is not sent twice.
 */
export const runSdkCallback = (
  callback: Effect.Effect<void, never, McpCallbackServices>,
): void => {
  runAfterResponse(
    callback.pipe(
      Effect.catchCause((cause) => ErrorReporter.report(cause)),
      Effect.andThen(flushSentry),
    ),
  );
};
