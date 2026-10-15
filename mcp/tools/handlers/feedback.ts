import { NEON_FEEDBACK_URL } from '../../../lib/config';

// Same bound as the docs tools: a stalled feedback service must not hold a
// Vercel concurrency slot for the full function duration.
const FEEDBACK_TIMEOUT_MS = 10_000;

// Stable source value so the feedback service can group MCP submissions.
const FEEDBACK_SOURCE = 'neon_mcp';

/**
 * Sends anonymous feedback to the Neon feedback service
 * (https://github.com/neondatabase/neon-feedback). Only the message and
 * source are sent: no account, project, or credentials.
 */
export async function sendFeedback({
  feedback,
}: {
  feedback: string;
}): Promise<void> {
  let response: Response;
  try {
    response = await fetch(NEON_FEEDBACK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback, source: FEEDBACK_SOURCE }),
      signal: AbortSignal.timeout(FEEDBACK_TIMEOUT_MS),
    });
  } catch (error) {
    // Without this, the agent sees only "TypeError: fetch failed".
    const reason =
      error instanceof Error && error.name === 'TimeoutError'
        ? 'did not respond in time'
        : 'could not be reached';
    throw new Error(`The Neon feedback service ${reason}. Try again later.`, {
      cause: error,
    });
  }
  if (response.status === 429) {
    throw new Error('Too many feedback requests. Wait a minute and try again.');
  }
  if (!response.ok) {
    throw new Error(
      `Failed to send feedback: ${response.status} ${response.statusText}`,
    );
  }
}
