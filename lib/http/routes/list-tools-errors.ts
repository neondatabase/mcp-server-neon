import { Schema } from 'effect';

/** A step of building the response threw; `phase` names the step. */
export class ListToolsFailed extends Schema.TaggedError<
  ListToolsFailed,
  { readonly brand: unique symbol }
>()('ListToolsFailed', {
  phase: Schema.String,
  errorName: Schema.String,
  errorMessage: Schema.String,
  errorStack: Schema.optional(Schema.String),
}) {}
