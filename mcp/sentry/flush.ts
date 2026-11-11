import { flush } from '@sentry/node';
import { waitUntil } from '@vercel/functions';

const FLUSH_TIMEOUT_MS = 2_000;

function flushInBackground(): void {
  waitUntil(flush(FLUSH_TIMEOUT_MS));
}

/**
 * Sentry buffers logs and sends spans in the background, and Vercel can freeze
 * the function once its response ends. A tool call's span and logs end only
 * when its body has been sent, so the flush waits for that.
 */
export function flushAfterResponse(response: Response): Response {
  if (!response.body) {
    flushInBackground();
    return response;
  }
  const body = response.body.pipeThrough(
    new TransformStream({ flush: flushInBackground }),
  );
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
