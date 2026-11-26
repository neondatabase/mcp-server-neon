import { Writable } from 'node:stream';
import { Cause, Effect } from 'effect';
import winston from 'winston';
import { z } from 'zod';
import { afterEach, describe, expect, layer } from '@effect/vitest';
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

  layer(WinstonLoggerLayer)((it) => {
    it.effect(
      'passes Effect debug logs to winston when LOG_LEVEL is debug',
      () =>
        Effect.gen(function* () {
          const lines = captureAt('debug');

          yield* Effect.logDebug('effect debug line').pipe(
            Effect.annotateLogs({ phase: 'test' }),
          );

          expect(lines).toStrictEqual([
            `${JSON.stringify({ level: 'debug', message: 'effect debug line', phase: 'test' })}\n`,
          ]);
        }),
    );

    it.effect('leaves the filtering to winston', () =>
      Effect.gen(function* () {
        const lines = captureAt('info');

        yield* Effect.logDebug('dropped');

        expect(lines).toStrictEqual([]);
      }),
    );

    it.effect('passes a logged cause and structured values to winston', () =>
      Effect.gen(function* () {
        const lines = captureAt('info');

        yield* Effect.logError(
          'failed operation',
          { phase: 'store' },
          Cause.fail(new Error('diagnostic detail')),
        );

        expect(lines).toHaveLength(1);

        const entry = z
          .object({ message: z.string(), cause: z.string() })
          .parse(JSON.parse(lines.join('')));

        expect(entry.message).toBe('failed operation {"phase":"store"}');
        expect(entry.cause).toContain('diagnostic detail');
      }),
    );
  });
});
