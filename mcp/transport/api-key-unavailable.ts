import { Schema } from 'effect';

/** Neon could not be reached to verify an API key; `cause` is the last failure. */
export class ApiKeyVerificationUnavailable extends Schema.TaggedError<
  ApiKeyVerificationUnavailable,
  { readonly brand: unique symbol }
>()('ApiKeyVerificationUnavailable', { cause: Schema.Unknown }) {}
