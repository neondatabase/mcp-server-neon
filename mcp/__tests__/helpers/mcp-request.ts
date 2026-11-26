import { z } from 'zod';

type McpRequestInput = {
  readonly method: string;
  readonly params?: z.core.util.JSONType;
  readonly bearerToken?: string;
  /** Appended to `/api/mcp`, such as `?category=docs`. */
  readonly queryString?: string;
  readonly id?: number;
  readonly headers?: Record<string, string>;
};

/** A stateless JSON-RPC POST to the MCP transport. */
export const mcpRequest = ({
  method,
  params,
  bearerToken,
  queryString = '',
  id = 1,
  headers = {},
}: McpRequestInput) => {
  const requestHeaders = new Headers({
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...headers,
  });

  if (bearerToken !== undefined) {
    requestHeaders.set('Authorization', `Bearer ${bearerToken}`);
  }

  return new Request(`http://localhost/api/mcp${queryString}`, {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify(
      params === undefined
        ? { jsonrpc: '2.0', id, method }
        : { jsonrpc: '2.0', id, method, params },
    ),
  });
};

const lastDataLine = (raw: string) =>
  raw
    .split('\n')
    .findLast((line) => line.startsWith('data: '))
    ?.slice('data: '.length);

/**
 * The JSON a transport response carries, from a JSON body or the last SSE
 * `data:` line; the raw text when it carries none.
 */
export const responseBody = (raw: string): z.core.util.JSONType => {
  try {
    return z.json().parse(JSON.parse(lastDataLine(raw) ?? raw));
  } catch {
    return raw;
  }
};

const ToolsList = z.object({
  result: z.object({ tools: z.array(z.object({ name: z.string() })) }),
});

/** The tool names in a `tools/list` result; throws on any other body. */
export const listedToolNames = (body: z.core.util.JSONType) =>
  ToolsList.parse(body).result.tools.map((tool) => tool.name);
