import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NeonApiError, NeonError } from '@neon/sdk';
import { createNeonTools } from '@neon/tools';
import { NeonDbError } from '@neondatabase/serverless';
import { InvalidArgumentError } from '../server/errors';

const captureException = vi.hoisted(() => vi.fn());

vi.mock('@sentry/node', () => ({
  captureException,
}));

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
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

  it('captures 5xx Neon API errors with the same tags', () => {
    const error = new NeonApiError('Internal Server Error', { status: 500 });
    handleToolError(error, properties, undefined, agent);

    expect(captureException).toHaveBeenCalledWith(error, {
      extra: properties,
      tags: {
        'client.agent': 'ChatGPT',
        'client.application': 'chatgpt',
      },
    });
  });

  it('does not capture client, 4xx API, or database errors', () => {
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
      new NeonDbError('relation missing'),
      properties,
      'trace-1',
      agent,
    );

    expect(captureException).not.toHaveBeenCalled();
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

  it('does not capture Neon SDK client errors from either SDK copy', () => {
    handleToolError(
      new NeonError('Branch has no parent and cannot be reset.', 'client'),
      properties,
      'trace-1',
      agent,
    );
    handleToolError(
      Object.assign(new Error('Branch has no parent and cannot be reset.'), {
        name: 'NeonClientError',
        kind: 'client',
      }),
      properties,
      'trace-1',
      agent,
    );

    expect(captureException).not.toHaveBeenCalled();
  });

  it('captures Neon SDK errors of other kinds', () => {
    const error = new NeonError('operation failed', 'operation');
    handleToolError(error, properties, 'trace-1', agent);

    expect(captureException).toHaveBeenCalledWith(error, expect.anything());
  });

  it('does not capture 4xx API errors created by another SDK copy', () => {
    const error = Object.assign(
      new Error('role with that name already exists'),
      {
        name: 'NeonApiError',
        kind: 'api',
        status: 409,
        body: { message: 'role with that name already exists' },
      },
    );

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
