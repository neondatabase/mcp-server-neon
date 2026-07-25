/**
 * Integration coverage for the telemetry read transport against a real HTTP server.
 *
 * Regression for Sentry issue MCP-SERVER-GT: the read API is reached through the
 * console's edge, so `query_logs` / `list_log_fields` / `list_log_field_values` can
 * receive an HTML page (gateway 502/504, WAF block, auth redirect) instead of the
 * Loki JSON envelope. The transport used to hand every body to `response.json()`,
 * turning those pages into `SyntaxError: Unexpected token '<', "<!DOCTYPE "... is
 * not valid JSON` — an error that names neither the status code nor the endpoint,
 * so it could not be told apart from a caller mistake.
 *
 * These tests drive the real `createNeonClient().request` over a real socket against
 * a server that answers with the bodies the edge actually returns. Nothing is mocked:
 * the assertions cover which Error class each status produces, because that class is
 * what decides whether handleToolError reports to Sentry (a backend fault) or returns
 * a client error to the LLM (the caller's fault).
 */

import { createServer, type Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { NeonApiClient } from '../neon-client';
import type { TelemetryScope } from '../otel/types';

type StubResponse = {
  status: number;
  contentType?: string;
  body: string;
};

type OtelClient = typeof import('../otel/client');
type ServerErrors = typeof import('../server/errors');

const SCOPE: TelemetryScope = {
  projectId: 'proj-transport',
  branchId: 'br-transport',
};

const HTML_GATEWAY_PAGE = `<!DOCTYPE html>
<html>
  <head><title>502 Bad Gateway</title></head>
  <body>
    <h1>502 Bad Gateway</h1>
    <p>The server encountered a temporary error and could not complete your request.</p>
  </body>
</html>`;

const LOKI_STREAMS_BODY = JSON.stringify({
  status: 'success',
  data: {
    resultType: 'streams',
    result: [
      {
        stream: { service_name: 'api', severity_text: 'ERROR' },
        values: [['1700000000000000000', 'boom']],
      },
    ],
  },
});

let server: Server;
let stub: StubResponse = {
  status: 200,
  contentType: 'application/json',
  body: '{}',
};
let receivedAuthorization: string | undefined;
let otel: OtelClient;
let errors: ServerErrors;
let client: NeonApiClient;

/** Resolve the error a rejected promise produced, failing the test if it resolves. */
async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    throw new Error(`Expected an Error instance, received ${typeof error}`);
  }
  throw new Error('Expected the telemetry request to reject, but it resolved');
}

beforeAll(async () => {
  server = createServer((req, res) => {
    receivedAuthorization = req.headers.authorization;
    res.writeHead(stub.status, {
      ...(stub.contentType && { 'Content-Type': stub.contentType }),
    });
    res.end(stub.body);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error(
      'Expected the stub telemetry server to listen on a TCP port',
    );
  }
  const { port } = address;

  // lib/config captures NEON_TELEMETRY_API_HOST at module load, so the override has
  // to be in place before anything that transitively imports it is loaded.
  process.env.NEON_TELEMETRY_API_HOST = `http://127.0.0.1:${port}`;
  otel = await import('../otel/client');
  errors = await import('../server/errors');
  const { createNeonClient } = await import('../neon-client');
  client = createNeonClient('test-api-key');
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

afterEach(() => {
  receivedAuthorization = undefined;
});

describe('telemetry transport: non-JSON bodies', () => {
  it('reports an HTML gateway page as a backend fault, not a JSON parse error', async () => {
    stub = {
      status: 502,
      contentType: 'text/html; charset=utf-8',
      body: HTML_GATEWAY_PAGE,
    };

    const error = await captureError(
      otel.queryRange(client, {
        scope: SCOPE,
        query: '{entity_type="function"}',
      }),
    );

    // The bug: undici's JSON.parse raised SyntaxError before any status mapping ran.
    expect(error).not.toBeInstanceOf(SyntaxError);
    expect(error.message).not.toContain('is not valid JSON');

    // A 5xx must stay a plain Error so handleToolError captures it to Sentry.
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(errors.InvalidArgumentError);
    expect(error.message).toContain('Telemetry backend error');
    expect(error.message).toContain('HTTP 502');
    expect(error.message).toContain('text/html');
    expect(error.message).toContain('502 Bad Gateway');
  });

  it('collapses and truncates the page so it cannot flood the error message', async () => {
    stub = {
      status: 504,
      contentType: 'text/html',
      body: `<!DOCTYPE html><html><body>${'gateway timeout '.repeat(200)}</body></html>`,
    };

    const error = await captureError(
      otel.queryRange(client, {
        scope: SCOPE,
        query: '{entity_type="function"}',
      }),
    );

    expect(error.message).toContain('HTTP 504');
    expect(error.message).toContain('…');
    // Bounded message: the snippet cap plus the surrounding sentence, not 3KB of HTML.
    expect(error.message.length).toBeLessThan(400);
    expect(error.message).not.toContain('\n');
  });

  it('treats a 4xx HTML page as a client error kept out of Sentry', async () => {
    // What an auth redirect or WAF block looks like: HTML, and the caller's problem.
    stub = {
      status: 403,
      contentType: 'text/html',
      body: '<!DOCTYPE html><html><body>Forbidden</body></html>',
    };

    const error = await captureError(
      otel.queryRange(client, {
        scope: SCOPE,
        query: '{entity_type="function"}',
      }),
    );

    expect(error).toBeInstanceOf(errors.InvalidArgumentError);
    expect(error).not.toBeInstanceOf(SyntaxError);
    expect(error.message).toContain('HTTP 403');
    expect(error.message).toContain('non-JSON response');
  });

  it('treats HTML served with a 200 as a backend fault', async () => {
    // A success status with an HTML body means the edge answered instead of the
    // backend; silently returning it would hand the LLM a bogus empty result.
    stub = {
      status: 200,
      contentType: 'text/html',
      body: '<!DOCTYPE html><html><body>Sign in to continue</body></html>',
    };

    const error = await captureError(otel.listLabels(client, SCOPE));

    expect(error).not.toBeInstanceOf(errors.InvalidArgumentError);
    expect(error.message).toContain('Telemetry backend error');
    expect(error.message).toContain('HTTP 200');
  });

  it('reports an empty body without a parse error', async () => {
    stub = { status: 200, contentType: 'application/json', body: '' };

    const error = await captureError(
      otel.listLabelValues(client, { scope: SCOPE, label: 'service_name' }),
    );

    expect(error).not.toBeInstanceOf(SyntaxError);
    expect(error.message).toContain('<empty body>');
  });

  it('reports a JSON content type carrying an HTML body', async () => {
    // Gateways mislabel their error pages, which is why the bytes decide, not the header.
    stub = {
      status: 502,
      contentType: 'application/json',
      body: '<!DOCTYPE html><html><body>Bad Gateway</body></html>',
    };

    const error = await captureError(
      otel.listLabelValues(client, { scope: SCOPE, label: 'service_name' }),
    );

    expect(error).not.toBeInstanceOf(SyntaxError);
    expect(error.message).toContain('HTTP 502');
    expect(error.message).toContain('Bad Gateway');
  });
});

describe('telemetry transport: JSON bodies', () => {
  it('returns the parsed Loki envelope on success', async () => {
    stub = {
      status: 200,
      contentType: 'application/json',
      body: LOKI_STREAMS_BODY,
    };

    const response = await otel.queryRange(client, {
      scope: SCOPE,
      query: '{entity_type="function"}',
      since: '1h',
      limit: 50,
    });

    expect(response.status).toBe('success');
    expect(response.data.result[0].values[0][1]).toBe('boom');
    // Proves the assertions above exercise the real authenticated request path.
    expect(receivedAuthorization).toBe('Bearer test-api-key');
  });

  it('still surfaces a Loki error envelope on a 4xx as a client error', async () => {
    stub = {
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'error', error: 'parse error at line 1' }),
    };

    const error = await captureError(
      otel.queryRange(client, { scope: SCOPE, query: '{invalid' }),
    );

    expect(error).toBeInstanceOf(errors.InvalidArgumentError);
    expect(error.message).toContain('parse error at line 1');
  });

  it('still surfaces a Loki error envelope on a 5xx as a backend fault', async () => {
    stub = {
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'error', error: 'ingester unavailable' }),
    };

    const error = await captureError(otel.listLabels(client, SCOPE));

    expect(error).not.toBeInstanceOf(errors.InvalidArgumentError);
    expect(error.message).toContain('Telemetry backend error');
    expect(error.message).toContain('ingester unavailable');
  });

  it('returns scalar label values on success', async () => {
    stub = {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'success', data: ['api', 'worker'] }),
    };

    const values = await otel.listLabelValues(client, {
      scope: SCOPE,
      label: 'service_name',
      since: '24h',
    });

    expect(values).toEqual(['api', 'worker']);
  });
});
