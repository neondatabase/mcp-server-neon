import { Schema } from 'effect';

/**
 * A plain function the server runs around a package tool threw: input
 * parsing, result rendering, or the output contract check. `error` is what it
 * threw, so it is rendered and classified like a package error.
 */
export class ToolStepFailed extends Schema.TaggedError<
  ToolStepFailed,
  { readonly brand: unique symbol }
>()('ToolStepFailed', { error: Schema.instanceOf(Error) }) {}
