import { Schema } from 'effect';

/** The caller passed no `org_id` and its account has no single organization to default to. */
export class NoDefaultOrganization extends Schema.TaggedError<
  NoDefaultOrganization,
  { readonly brand: unique symbol }
>()('NoDefaultOrganization', { message: Schema.String }) {}
