import { Writable } from 'node:stream';
import { Cause, Effect } from 'effect';
import winston from 'winston';
import { z } from 'zod';
import { afterEach, describe, expect, it } from 'vitest';
import { WinstonLoggerLayer } from '../../lib/effect/logger';
import { logger } from '../utils/logger';

const initialLevel = logger.level;
const transports: winston.transport[] = [];

const captureAt = (level: string): string[] => {
  const lines: string[] = [];

  const transport = new winston.transports.Stream({
    stream: new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    }),
  });

  logger.level = level;
  logger.add(transport);
  transports.push(transport);

  return lines;
};

describe('WinstonLoggerLayer', () => {
  afterEach(() => {
    for (const transport of transports.splice(0)) {
      logger.remove(transport);
    }

    logger.level = initialLevel;
  });

  it('passes Effect debug logs to winston when LOG_LEVEL is debug', async () => {
    const lines = captureAt('debug');

    await Effect.runPromise(
      Effect.logDebug('effect debug line').pipe(
        Effect.annotateLogs({ phase: 'test' }),
        Effect.provide(WinstonLoggerLayer),
      ),
    );

    expect(lines).toStrictEqual([
      `${JSON.stringify({ level: 'debug', message: 'effect debug line', phase: 'test' })}\n`,
    ]);
  });

  it('leaves the filtering to winston', async () => {
    const lines = captureAt('info');

    await Effect.runPromise(
      Effect.logDebug('dropped').pipe(Effect.provide(WinstonLoggerLayer)),
    );

    expect(lines).toStrictEqual([]);
  });

  it('passes a logged cause and structured values to winston', async () => {
    const lines = captureAt('info');

    await Effect.runPromise(
      Effect.logError(
        'failed operation',
        { phase: 'store' },
        Cause.fail(new Error('diagnostic detail')),
      ).pipe(Effect.provide(WinstonLoggerLayer)),
    );

    expect(lines).toHaveLength(1);

    const entry = z
      .object({ message: z.string(), cause: z.string() })
      .parse(JSON.parse(lines.join('')));

    expect(entry.message).toBe('failed operation {"phase":"store"}');
    expect(entry.cause).toContain('diagnostic detail');
  });
});
