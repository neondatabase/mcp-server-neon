import { Schema } from 'effect';

/**
 * An upstream refresh attempt ran past its time limit and was cancelled.
 * Hydra may still have rotated the token, so it is never retried. The tag
 * keeps the `name` the upstream failure log has always shown.
 */
export class UpstreamTimeoutError extends Schema.TaggedError<
  UpstreamTimeoutError,
  { readonly brand: unique symbol }
>()('UpstreamTimeoutError', { timeoutMs: Schema.Finite }) {
  override get message(): string {
    return `Upstream refresh timed out after ${this.timeoutMs}ms`;
  }
}
