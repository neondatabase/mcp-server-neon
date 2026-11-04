import { beforeEach, describe, expect, it, vi } from 'vitest';

const { captureExceptionSpy, logger } = vi.hoisted(() => ({
  captureExceptionSpy: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@sentry/node', () => ({ captureException: captureExceptionSpy }));
vi.mock('../utils/logger', () => ({ logger }));

const { createSdkErrorReporter } = await import('../server/sdk-errors');

const tags = { client_application: 'test-client' };

function sdkError(message: string) {
  return {
    type: 'ERROR' as const,
    timestamp: 0,
    error: new Error(message),
    source: 'request' as const,
    severity: 'error' as const,
  };
}

describe('createSdkErrorReporter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports an error behind a 5xx response to Sentry', async () => {
    const reporter = createSdkErrorReporter(() => tags);
    reporter.onError(sdkError('factory failed'));
    await reporter.settleAfter(
      Promise.resolve(new Response(null, { status: 500 })),
    );

    expect(logger.error).toHaveBeenCalledWith(
      'MCP SDK error',
      expect.objectContaining({ message: 'factory failed', status: 500 }),
    );
    expect(captureExceptionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'factory failed' }),
      {
        tags,
        extra: { source: 'request', severity: 'error', status: 500 },
      },
    );
  });

  it('logs an error behind a 4xx response as a rejected request only', async () => {
    const reporter = createSdkErrorReporter(() => tags);
    reporter.onError(sdkError('Unsupported protocol version'));
    await reporter.settleAfter(
      Promise.resolve(new Response(null, { status: 400 })),
    );

    expect(logger.warn).toHaveBeenCalledWith('MCP SDK rejected request', {
      status: 400,
      source: 'request',
      errorName: 'Error',
    });
    expect(logger.error).not.toHaveBeenCalled();
    expect(captureExceptionSpy).not.toHaveBeenCalled();
  });

  it('reports an error raised after the response to Sentry', async () => {
    const reporter = createSdkErrorReporter(() => tags);
    await reporter.settleAfter(
      Promise.resolve(new Response(null, { status: 200 })),
    );
    reporter.onError(sdkError('stream write failed'));

    expect(captureExceptionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'stream write failed' }),
      expect.objectContaining({
        extra: { source: 'request', severity: 'error', status: undefined },
      }),
    );
  });

  it('reports pending errors and rethrows when the handler throws', async () => {
    const reporter = createSdkErrorReporter(() => tags);
    reporter.onError(sdkError('handler crashed'));
    const thrown = new Error('handler crashed');

    await expect(reporter.settleAfter(Promise.reject(thrown))).rejects.toBe(
      thrown,
    );
    expect(captureExceptionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'handler crashed' }),
      expect.objectContaining({
        extra: { source: 'request', severity: 'error', status: 500 },
      }),
    );
  });
});
