import { Schema } from 'effect';

/** The OpenAPI spec could not be fetched, parsed, or resolved for a route. */
export class ApiSpecUnavailable extends Schema.TaggedError<
  ApiSpecUnavailable,
  { readonly brand: unique symbol }
>()('ApiSpecUnavailable', { message: Schema.String }) {}
