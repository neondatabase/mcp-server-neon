import { flush } from '@sentry/node';
import { waitUntil } from '@vercel/functions';
import { Effect } from 'effect';

const FLUSH_TIMEOUT_MS = 2_000;

/** Keeps a serverless function alive until Sentry has sent what it buffered. */
export function flushInBackground(): void {
  waitUntil(flush(FLUSH_TIMEOUT_MS));
}

/** Sends what Sentry has buffered, for work that outlives its response. */
export const flushSentry = Effect.promise(async () =>
  flush(FLUSH_TIMEOUT_MS),
).pipe(Effect.asVoid);

// Node runs `cancel` when the client cancels the body or the source stream
// fails; TypeScript's DOM lib doesn't declare it yet.
const flushWhenBodyEnds: Transformer<Uint8Array, Uint8Array> & {
  cancel: () => void;
} = { flush: flushInBackground, cancel: flushInBackground };

/**
 * Sentry buffers logs and sends spans in the background, and Vercel can freeze
 * the function once its response ends. A tool call's span and logs end only
 * when its body has been sent, so the flush waits for that, or for the body to
 * fail or the client to cancel it.
 */
export const flushAfterResponse = (response: Response) =>
  Effect.sync(() => {
    if (!response.body) {
      flushInBackground();
      return response;
    }
    const body = response.body.pipeThrough(
      new TransformStream(flushWhenBodyEnds),
    );
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  });
