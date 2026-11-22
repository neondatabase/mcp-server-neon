import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NeonApiError, NeonClientError, NeonError } from '@neon/sdk';
import { createNeonTools, InspectDiagnosticError } from '@neon/tools';
import { NeonDbError } from '@neondatabase/serverless';
import { InvalidArgumentError } from '../server/errors';

const captureException = vi.hoisted(() => vi.fn());
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

describe('handleToolError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tags captured exceptions with the identified agent', () => {
    const error = new Error('upstream failed');
    const result = handleToolError(error, properties, 'trace-1', agent);

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

    handleToolError(error, properties, undefined, agent);

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

    const result = handleToolError(error, properties, 'trace-1', agent);

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

  it('does not capture client, 4xx API, or Postgres statement errors', () => {
    handleToolError(
      new InvalidArgumentError('bad arg'),
      properties,
      'trace-1',
      agent,
    );
    handleToolError(
      new NeonApiError('Not Found', { status: 404 }),
      properties,
      'trace-1',
      agent,
    );
    handleToolError(
      Object.assign(new NeonDbError('relation "t" does not exist'), {
        code: '42P01',
      }),
      properties,
      'trace-1',
      agent,
    );

    expect(captureException).not.toHaveBeenCalled();
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

    const result = handleToolError(error, properties, 'trace-1', agent);

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
    const result = handleToolError(error, properties, 'trace-1', agent);

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
      properties,
      'trace-1',
      agent,
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

    const result = handleToolError(error, properties, 'trace-1', agent);

    expect(result.isError).toBe(true);
    expect(captureException).toHaveBeenCalledWith(error, expect.anything());
  });

  it('captures Neon SDK errors of other kinds', () => {
    const error = new NeonError('operation failed', 'operation');
    handleToolError(error, properties, 'trace-1', agent);

    expect(captureException).toHaveBeenCalledWith(error, expect.anything());
  });

  it('reports a 4xx API error with its status and does not capture it', () => {
    const error = new NeonApiError('role with that name already exists', {
      status: 409,
      body: { message: 'role with that name already exists' },
    });

    const result = handleToolError(error, properties, 'trace-1', agent);

    expect(result.isError).toBe(true);
    expect(result.content).toContainEqual(
      expect.objectContaining({
        text: expect.stringContaining('[HTTP 409]'),
      }),
    );
    expect(captureException).not.toHaveBeenCalled();
  });
});
