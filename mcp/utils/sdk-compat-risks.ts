import { isLegacyRequest } from '@modelcontextprotocol/server';
import { logger } from './logger';

// @modelcontextprotocol/server 2.0.0 serves both request shapes logged here;
// 2.2.0 answers both with 400. A request the current handler already rejects
// is not logged, since the upgrade changes nothing for it.
const MAX_BATCH_SIZE = 100;

type SdkCompatRisk = {
  message: string;
  fields: Record<string, string | number | undefined>;
};

function isRequestMessage(message: unknown): boolean {
  return (
    typeof message === 'object' &&
    message !== null &&
    'id' in message &&
    'method' in message
  );
}

async function findSdkCompatRisk(
  req: Request,
): Promise<SdkCompatRisk | undefined> {
  if (req.method !== 'POST') return undefined;

  let body: unknown;
  try {
    body = await req.clone().json();
  } catch {
    // The MCP handler answers an unparseable body with its own 400.
    return undefined;
  }

  const userAgent = req.headers.get('user-agent') ?? undefined;

  if (Array.isArray(body) && body.length > MAX_BATCH_SIZE) {
    return {
      message: 'MCP batch over 100 messages',
      fields: { batchSize: body.length, userAgent },
    };
  }

  if (
    isRequestMessage(body) &&
    !req.headers.has('mcp-protocol-version') &&
    !(await isLegacyRequest(req, body))
  ) {
    return {
      message: 'MCP 2026-07-28 request without MCP-Protocol-Version',
      fields: { method: req.headers.get('mcp-method') ?? undefined, userAgent },
    };
  }

  return undefined;
}

export async function withSdkCompatRiskLog(
  req: Request,
  serve: () => Promise<Response>,
): Promise<Response> {
  const risk = await findSdkCompatRisk(req);
  const response = await serve();
  if (risk && response.ok) logger.warn(risk.message, risk.fields);
  return response;
}
