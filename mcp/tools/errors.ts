import { Schema } from 'effect';

/**
 * A failure in the server's own steps around a package tool: input parsing,
 * the pinned-role check, org resolution, and result rendering. `error` is what
 * the step threw, so it is rendered and classified like a package error.
 */
export class ToolStepFailed extends Schema.TaggedError<
  ToolStepFailed,
  { readonly brand: unique symbol }
>()('ToolStepFailed', { error: Schema.instanceOf(Error) }) {}
