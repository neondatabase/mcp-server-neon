import { Effect, Match } from 'effect';
import { mcpRuntime } from '../../../lib/effect/runtime';
import type { McpCallbackServices } from '../../../lib/effect/runtime';
import type { ToolCallError } from '../../tools/types';

const thrownError = (error: ToolCallError): Error =>
  Match.value(error).pipe(
    Match.tag('ToolStepFailed', ({ error: thrown }) => thrown),
    Match.tagStartsWith('Neon', ({ cause }) => cause),
    Match.tag(
      'InvalidArgumentError',
      'NotFoundError',
      'InternalToolError',
      (own) => own,
    ),
    Match.exhaustive,
  );

/**
 * Runs a tool handler. A failure rejects with what the package or a step threw,
 * or with the server's own error.
 */
export const runToolHandler = async <A>(
  handler: Effect.Effect<A, ToolCallError, McpCallbackServices>,
): Promise<A> =>
  mcpRuntime.runPromise(
    handler.pipe(Effect.catch((error) => Effect.die(thrownError(error)))),
  );
