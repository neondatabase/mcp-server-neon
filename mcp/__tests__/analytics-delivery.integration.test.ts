import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import path from 'node:path';
import { Writable } from 'node:stream';
import winston from 'winston';
import { z } from 'zod';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { logger } from '../utils/logger';

const SegmentBatch = z.object({
  batch: z.array(z.object({ messageId: z.string() })),
});

const ChildExit = z.tuple([z.number().nullable(), z.string().nullable()]);

const LogLine = z.strictObject({
  level: z.string(),
  message: z.string(),
  code: z.string(),
  reason: z.string(),
});

let collectorAnswers: 'accept' | 'reject' = 'accept';
const deliveredMessageIds: string[] = [];

const collector = createServer((request, response) => {
  const chunks: Buffer[] = [];

  request.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });
  request.on('end', () => {
    if (collectorAnswers === 'reject') {
      response.writeHead(400).end();

      return;
    }

    const { batch } = SegmentBatch.parse(
      JSON.parse(Buffer.concat(chunks).toString()),
    );

    deliveredMessageIds.push(...batch.map((event) => event.messageId));
    response.writeHead(200).end('{}');
  });
});

collector.listen(0, '127.0.0.1');

await once(collector, 'listening');

const { port } = z.object({ port: z.number() }).parse(collector.address());

const collectorEnv = {
  ANALYTICS_HOST: `http://127.0.0.1:${port}`,
  ANALYTICS_WRITE_KEY: 'analytics-delivery-test-key',
};

Object.assign(process.env, collectorEnv);

delete process.env.NEON_MCP_DISABLE_ANALYTICS;

const { flushAnalytics, track } = await import('../analytics/analytics');

const trackAndFlush = async (messageId: string) => {
  track({ userId: 'user-1', event: 'tool_call', messageId });
  await flushAnalytics();

  return deliveredMessageIds.includes(messageId);
};

const captureLogs = () => {
  const lines: string[] = [];

  const transport = new winston.transports.Stream({
    stream: new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    }),
  });

  logger.add(transport);

  return {
    lines,
    stop: () => {
      logger.remove(transport);
    },
  };
};

const runOverlappingEventsInChildProcess = async () => {
  const driver = `
    import { flushAnalytics, track } from './mcp/analytics/analytics';
    await Promise.all(
      Array.from({ length: 20 }, (_, index) => {
        track({ userId: 'user-1', event: 'tool_call', messageId: 'child-' + index });
        return flushAnalytics();
      }),
    );
  `;

  const child = spawn(
    path.resolve('node_modules/.bin/tsx'),
    ['--input-type=module', '--eval', driver],
    { env: { ...process.env, ...collectorEnv } },
  );

  const stderr: string[] = [];

  child.stderr.on('data', (chunk: Buffer) => {
    stderr.push(chunk.toString());
  });

  const [exitCode] = ChildExit.parse(await once(child, 'exit'));

  return { exitCode, stderr: stderr.join('') };
};

describe('analytics delivery with the Segment client', () => {
  beforeEach(() => {
    collectorAnswers = 'accept';
    deliveredMessageIds.length = 0;
  });

  afterAll(() => {
    collector.close();
  });

  it('logs a failed delivery without the event or account data', async () => {
    collectorAnswers = 'reject';
    const logs = captureLogs();

    track({
      userId: 'user-secret-id',
      event: 'tool_call',
      properties: { email: 'ada@example.com', toolName: 'run_sql' },
    });
    await flushAnalytics();
    logs.stop();

    expect(
      logs.lines.map((line) => LogLine.parse(JSON.parse(line))),
    ).toStrictEqual([
      {
        level: 'warn',
        message: 'Analytics delivery failed',
        code: 'delivery_failure',
        reason: '[400] Bad Request',
      },
    ]);
  });

  it('resolves every overlapping flush only after its own event is delivered', async () => {
    const messageIds = Array.from(
      { length: 20 },
      (_, index) => `overlap-${index}`,
    );

    const deliveredBeforeFlushResolved = await Promise.all(
      messageIds.map(async (messageId) => trackAndFlush(messageId)),
    );

    expect(deliveredBeforeFlushResolved).toStrictEqual(
      messageIds.map(() => true),
    );
    expect(deliveredMessageIds.toSorted()).toStrictEqual(messageIds.toSorted());

    await expect(trackAndFlush('after-settled-flush')).resolves.toBe(true);
    expect(deliveredMessageIds).toHaveLength(messageIds.length + 1);
  });

  it('prints no overlapping-flush warning when events overlap', async () => {
    const { exitCode, stderr } = await runOverlappingEventsInChildProcess();

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain('Overlapping flush');
    expect(deliveredMessageIds.toSorted()).toStrictEqual(
      Array.from({ length: 20 }, (_, index) => `child-${index}`).toSorted(),
    );
  }, 30_000);
});
