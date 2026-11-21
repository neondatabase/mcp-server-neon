import { Schema } from 'effect';

/** A refresh-lock store call failed or hit its timeout. */
export class RefreshLockStoreFailed extends Schema.TaggedError<
  RefreshLockStoreFailed,
  { readonly brand: unique symbol }
>()('RefreshLockStoreFailed', {
  store: Schema.String,
  operation: Schema.String,
  cause: Schema.Unknown,
}) {
  override get message(): string {
    return `refresh-lock ${this.store} ${this.operation} failed`;
  }
}
