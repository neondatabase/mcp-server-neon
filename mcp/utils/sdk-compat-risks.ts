import { isLegacyRequest } from '@modelcontextprotocol/server';
import { logger } from './logger';

// @modelcontextprotocol/server 2.0.0 serves both request shapes logged here;
// 2.2.0 answers both with 400.
const MAX_BATCH_SIZE = 100;

function isRequestMessage(message: unknown): boolean {
  return (
    typeof message === 'object' &&
    message !== null &&
    'id' in message &&
    'method' in message
  );
}

export async function logSdkCompatRisks(req: Request): Promise<void> {
  if (req.method !== 'POST') return;

  let body: unknown;
  try {
    body = await req.clone().json();
  } catch {
    // The MCP handler answers an unparseable body with its own 400.
    return;
  }

  const userAgent = req.headers.get('user-agent') ?? undefined;

  if (Array.isArray(body) && body.length > MAX_BATCH_SIZE) {
    logger.warn('MCP batch over 100 messages', {
      batchSize: body.length,
      userAgent,
    });
    return;
  }

  if (
    isRequestMessage(body) &&
    !req.headers.has('mcp-protocol-version') &&
    !(await isLegacyRequest(req, body))
  ) {
    logger.warn('MCP 2026-07-28 request without MCP-Protocol-Version', {
      method: req.headers.get('mcp-method') ?? undefined,
      userAgent,
    });
  }
}
