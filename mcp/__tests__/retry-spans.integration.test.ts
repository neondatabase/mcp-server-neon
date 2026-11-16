/**
 * The span `retryAsync` leaves in Sentry: nested under the caller's span, with
 * the attempts and the outcome, and never failed by the retry itself.
 */
import { getClient, init, spanToJSON, startSpan } from '@sentry/node';
import { describe, expect, it, vi } from 'vitest';
import { retryAsync } from '../utils/retry';

init({ dsn: 'http://public@127.0.0.1:1/1', tracesSampleRate: 1 });

type RecordedSpan = {
  parentSpanId: string | undefined;
  status: string | undefined;
  attempts: unknown;
  outcome: unknown;
};

const retrySpans = new Map<string, RecordedSpan>();

getClient()?.on('spanEnd', (span) => {
  const { description, parent_span_id, status, data } = spanToJSON(span);

  if (description?.startsWith('retryAsync ') === true) {
    retrySpans.set(description, {
      parentSpanId: parent_span_id,
      status,
      attempts: data['retry.attempts'],
      outcome: data['retry.outcome'],
    });
  }
});

describe('retryAsync spans', () => {
  it('nests under the caller and records a recovered attempt', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue('ok');

    const parentSpanId = await startSpan(
      { name: 'request', op: 'test' },
      async (parent) => {
        await retryAsync(operation, {
          attempts: 2,
          delaysMs: [1],
          op: 'spans.recovered',
        });

        return parent.spanContext().spanId;
      },
    );

    expect(retrySpans.get('retryAsync spans.recovered')).toStrictEqual({
      parentSpanId,
      status: 'ok',
      attempts: 2,
      outcome: 'success',
    });
  });

  it('records a final failure without failing the span', async () => {
    const failure = new Error('still down');

    await expect(
      retryAsync(
        async () => {
          throw failure;
        },
        { attempts: 2, delaysMs: [1], op: 'spans.failed' },
      ),
    ).rejects.toBe(failure);

    expect(retrySpans.get('retryAsync spans.failed')).toMatchObject({
      status: 'ok',
      attempts: 2,
      outcome: 'failure',
    });
  });
});
