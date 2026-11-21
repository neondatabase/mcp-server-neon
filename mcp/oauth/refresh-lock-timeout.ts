import { Schema } from 'effect';

/**
 * A waiter spent its whole budget without the holder resolving the refresh
 * token or letting the lock go. The client is told to retry.
 */
export class RefreshLockTimeout extends Schema.TaggedError<
  RefreshLockTimeout,
  { readonly brand: unique symbol }
>()('RefreshLockTimeout', {}) {
  override get message(): string {
    return 'Concurrent refresh in progress';
  }
}
