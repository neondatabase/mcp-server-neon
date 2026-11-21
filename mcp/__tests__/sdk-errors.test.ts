import { beforeEach, describe, expect, it, vi } from 'vitest';

const { captureExceptionSpy, flushSpy, logger } = vi.hoisted(() => ({
  captureExceptionSpy: vi.fn(),
  flushSpy: vi.fn<(timeout: number) => Promise<boolean>>(async () => true),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@sentry/node', () => ({
  captureException: captureExceptionSpy,
  flush: flushSpy,
}));
vi.mock('../utils/logger', () => ({ logger }));

const { mcpRuntime } = await import('../../lib/effect/runtime');
const { createSdkErrorReporter } = await import('../server/sdk-errors');

type Reporter = ReturnType<typeof createSdkErrorReporter>;

const respond = async (reporter: Reporter, status: number) =>
  mcpRuntime.runPromise(
    reporter.settleAfter(Promise.resolve(new Response(null, { status }))),
  );

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
    await respond(reporter, 500);

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
    await respond(reporter, 400);

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
    await respond(reporter, 200);
    reporter.onError(sdkError('stream write failed'));

    await vi.waitFor(() => {
      expect(captureExceptionSpy).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'stream write failed' }),
        expect.objectContaining({
          extra: { source: 'request', severity: 'error', status: undefined },
        }),
      );
    });
  });

  it('reports pending errors and rethrows when the handler throws', async () => {
    const reporter = createSdkErrorReporter(() => tags);
    reporter.onError(sdkError('handler crashed'));
    const thrown = new Error('handler crashed');

    await expect(
      mcpRuntime.runPromise(reporter.settleAfter(Promise.reject(thrown))),
    ).rejects.toBe(thrown);
    expect(captureExceptionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'handler crashed' }),
      expect.objectContaining({
        extra: { source: 'request', severity: 'error', status: 500 },
      }),
    );
  });

  it('keeps the function alive to report held errors after a client disconnect', async () => {
    const keepalives: Promise<unknown>[] = [];
    const requestContext = Symbol.for('@vercel/request-context');

    Object.defineProperty(globalThis, requestContext, {
      value: {
        get: () => ({
          waitUntil: (promise: Promise<unknown>) => keepalives.push(promise),
        }),
      },
      configurable: true,
    });

    try {
      const reporter = createSdkErrorReporter(() => tags);
      const response = Promise.withResolvers<Response>();
      const disconnect = new AbortController();

      reporter.onError(sdkError('factory failed before disconnect'));

      const request = mcpRuntime.runPromiseExit(
        reporter.settleAfter(response.promise),
        { signal: disconnect.signal },
      );

      disconnect.abort();
      await request;

      expect(keepalives).toHaveLength(1);

      response.resolve(new Response(null, { status: 500 }));
      await Promise.all(keepalives);

      expect(captureExceptionSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'factory failed before disconnect',
        }),
        expect.objectContaining({
          extra: { source: 'request', severity: 'error', status: 500 },
        }),
      );
      expect(flushSpy).toHaveBeenCalledWith(2000);
    } finally {
      Reflect.deleteProperty(globalThis, requestContext);
    }
  });
});
