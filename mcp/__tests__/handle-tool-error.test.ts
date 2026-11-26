import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NeonApiError,
  NeonClientError,
  NeonError,
  NeonNetworkError,
} from '@neon/sdk';
import { createNeonTools, InspectDiagnosticError } from '@neon/tools';
import { NeonDbError } from '@neondatabase/serverless';
import type { captureException as sentryCaptureException } from '@sentry/node';
import { InvalidArgumentError } from '../server/errors';

const captureException = vi.hoisted(() =>
  vi.fn<typeof sentryCaptureException>(),
);

const logError = vi.hoisted(() => vi.fn());

vi.mock('@sentry/node', () => ({
  captureException,
}));

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: logError,
    debug: vi.fn(),
  },
}));

const { handleToolError } = await import('../server/errors');

const agent = {
  clientName: 'ChatGPT',
  clientApplication: 'chatgpt' as const,
};

const properties = {
  toolName: 'run_sql',
  clientName: agent.clientName,
  clientApplication: agent.clientApplication,
};

const context = { properties, traceId: 'trace-1', agent, readOnlyTool: false };

describe('handleToolError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tags captured exceptions with the identified agent', () => {
    const error = new Error('upstream failed');
    const result = handleToolError(error, context);

    expect(result.isError).toBe(true);
    expect(captureException).toHaveBeenCalledWith(error, {
      extra: { ...properties, traceId: 'trace-1' },
      tags: {
        'client.agent': 'ChatGPT',
        'client.application': 'chatgpt',
      },
    });
  });

  it('captures 5xx Neon API errors with the agent tags and the status', () => {
    const error = new NeonApiError('Internal Server Error', {
      status: 500,
      code: '',
    });

    handleToolError(error, { ...context, traceId: undefined });

    expect(captureException).toHaveBeenCalledWith(error, {
      extra: { ...properties, neonApiStatus: '500' },
      tags: {
        'client.agent': 'ChatGPT',
        'client.application': 'chatgpt',
        'neon.api.status': '500',
      },
    });
  });

  it('reports the status, code, request id, and Retry-After of a Neon API 5xx', () => {
    const error = new NeonApiError('please try again later', {
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      requestId: 'req-503',
      response: new Response(null, {
        status: 503,
        headers: { 'retry-after': '30' },
      }),
      body: { message: 'please try again later' },
    });

    const result = handleToolError(error, context);

    expect(result.content).toStrictEqual([
      {
        type: 'text',
        text: [
          'NeonApiError: please try again later',
          'HTTP status: 503',
          'Code: SERVICE_UNAVAILABLE',
          'Request ID: req-503',
          'Retry-After: 30',
        ].join('\n'),
      },
    ]);

    const apiDetails = {
      neonApiStatus: '503',
      neonApiCode: 'SERVICE_UNAVAILABLE',
      neonApiRequestId: 'req-503',
      neonApiRetryAfter: '30',
    };

    expect(logError).toHaveBeenCalledWith(
      'Tool call error:',
      expect.objectContaining(apiDetails),
    );
    expect(captureException).toHaveBeenCalledWith(error, {
      extra: { ...properties, traceId: 'trace-1', ...apiDetails },
      tags: {
        'client.agent': 'ChatGPT',
        'client.application': 'chatgpt',
        'neon.api.status': '503',
      },
    });
  });

  it('tells the agent whether a call the Neon API never answered can be sent again', () => {
    const error = new NeonNetworkError(
      'Network error: no response received from the Neon API (UND_ERR_CONNECT_TIMEOUT).',
      { reason: 'UND_ERR_CONNECT_TIMEOUT' },
    );

    const read = handleToolError(error, { ...context, readOnlyTool: true });
    const write = handleToolError(error, context);

    expect(read.content).toStrictEqual([
      {
        type: 'text',
        text: [
          'NeonNetworkError: Network error: no response received from the Neon API (UND_ERR_CONNECT_TIMEOUT).',
          'The server already retried this read-only call. It changed nothing; call it again in a moment.',
        ].join('\n'),
      },
    ]);
    expect(write.content).toStrictEqual([
      {
        type: 'text',
        text: [
          'NeonNetworkError: Network error: no response received from the Neon API (UND_ERR_CONNECT_TIMEOUT).',
          'This tool can change resources, so the server did not run it again. Check the current state before calling it again.',
        ].join('\n'),
      },
    ]);
    expect(
      captureException.mock.calls.map(([captured]) => captured),
    ).toStrictEqual([error, error]);
  });

  it('does not capture client, 4xx API, or Postgres statement errors', () => {
    handleToolError(new InvalidArgumentError('bad arg'), context);
    handleToolError(new NeonApiError('Not Found', { status: 404 }), context);
    handleToolError(
      Object.assign(new NeonDbError('relation "t" does not exist'), {
        code: '42P01',
      }),
      context,
    );

    expect(captureException).not.toHaveBeenCalled();
  });

  it("captures a SQL endpoint failure but not a driver answer that is the caller's", () => {
    const quota = new NeonDbError(
      'Server error (HTTP status 402): {"message":"Your account or project has exceeded the quota."}',
    );

    const blockedNetwork = new NeonDbError(
      'This connection is trying to access this endpoint from a blocked network.',
    );

    const loginRejected = new NeonDbError(
      'Server error (HTTP status 500): {"message":"SASL authentication failed","code":"08P01"}',
    );

    const unreadable = new NeonDbError(
      'Neon internal error: unexpected non-array response',
    );

    const raisedByQuery = Object.assign(
      new NeonDbError('Server error (HTTP status 503): raised by the query'),
      { code: 'P0001' },
    );

    const unreachable = Object.assign(
      new NeonDbError('Error connecting to database: fetch failed'),
      { sourceError: new TypeError('fetch failed') },
    );

    for (const error of [quota, blockedNetwork, loginRejected, raisedByQuery]) {
      handleToolError(error, context);
    }

    expect(captureException).not.toHaveBeenCalled();

    for (const error of [unreadable, unreachable]) {
      handleToolError(error, context);
    }

    expect(captureException.mock.calls.map(([error]) => error)).toStrictEqual([
      unreadable,
      unreachable,
    ]);
  });

  it('reports the Postgres error fields an agent needs to fix the query', () => {
    const error = Object.assign(
      new NeonDbError('function lower(integer) does not exist'),
      {
        severity: 'ERROR',
        code: '42883',
        position: '8',
        hint: 'No function matches the given name and argument types. You might need to add explicit type casts.',
        detail: undefined,
        where: '',
        routine: 'ParseFuncOrColumn',
      },
    );

    const result = handleToolError(error, context);

    expect(result.content).toEqual([
      {
        type: 'text',
        text: [
          'NeonDbError: function lower(integer) does not exist',
          'SQLSTATE: 42883',
          'POSITION: 8',
          'HINT: No function matches the given name and argument types. You might need to add explicit type casts.',
        ].join('\n'),
      },
    ]);
  });

  it('does not capture tool input that fails schema validation', () => {
    const { error } = createNeonTools({
      tools: ['projects.get'],
    })['projects.get'].inputSchema.safeParse({ project_id: 'My Project' });

    expect(error).toHaveProperty('name', 'ZodError');
    const result = handleToolError(error, context);

    expect(result.isError).toBe(true);
    expect(result.content).toContainEqual(
      expect.objectContaining({
        text: expect.stringContaining('project_id'),
      }),
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  it('does not capture Neon SDK client errors', () => {
    handleToolError(
      new NeonClientError('Branch has no parent and cannot be reset.'),
      context,
    );

    expect(captureException).not.toHaveBeenCalled();
  });

  it('captures a diagnostic query Postgres rejected, which is a package bug', () => {
    const cause = Object.assign(new NeonDbError('column "x" does not exist'), {
      code: '42703',
    });
    const error = new InspectDiagnosticError(
      'The "table-sizes" diagnostic failed against Postgres: column "x" does not exist',
      'table-sizes',
      cause,
    );

    const result = handleToolError(error, context);

    expect(result.isError).toBe(true);
    expect(captureException).toHaveBeenCalledWith(error, expect.anything());
  });

  it('captures Neon SDK errors of other kinds', () => {
    const error = new NeonError('operation failed', 'operation');
    handleToolError(error, context);

    expect(captureException).toHaveBeenCalledWith(error, expect.anything());
  });

  it('reports a 4xx API error with its status and does not capture it', () => {
    const error = new NeonApiError('role with that name already exists', {
      status: 409,
      body: { message: 'role with that name already exists' },
    });

    const result = handleToolError(error, context);

    expect(result.isError).toBe(true);
    expect(result.content).toContainEqual(
      expect.objectContaining({
        text: expect.stringContaining('[HTTP 409]'),
      }),
    );
    expect(captureException).not.toHaveBeenCalled();
  });
});
