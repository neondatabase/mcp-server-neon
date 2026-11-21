import { Effect } from 'effect';
import { mcpRuntime } from '../../../lib/effect/runtime';
import type { McpCallbackServices } from '../../../lib/effect/runtime';
import { thrownError } from '../../tools/tools';
import type { ToolCallError } from '../../tools/types';

/** Runs a tool handler. A failure rejects with the error the package or a step threw. */
export const runToolHandler = async <A>(
  handler: Effect.Effect<A, ToolCallError, McpCallbackServices>,
): Promise<A> =>
  mcpRuntime.runPromise(
    handler.pipe(Effect.catch((error) => Effect.die(thrownError(error)))),
  );
