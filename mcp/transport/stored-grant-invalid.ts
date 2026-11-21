import { Schema } from 'effect';

/** A stored OAuth token's grant does not parse. */
export class StoredGrantInvalid extends Schema.TaggedError<
  StoredGrantInvalid,
  { readonly brand: unique symbol }
>()('StoredGrantInvalid', { cause: Schema.Unknown }) {}
