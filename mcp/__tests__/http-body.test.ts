/**
 * Unit tests for the response-body decoding helpers. The transport-level behaviour
 * these support is covered end to end in telemetry-transport.integration.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { parseJsonBody, summarizeBody } from '../utils/http-body';

describe('parseJsonBody', () => {
  it('parses a JSON object body', () => {
    const result = parseJsonBody<{ status: string }>('{"status":"success"}');

    expect(result).toEqual({ ok: true, value: { status: 'success' } });
  });

  it('parses JSON regardless of the declared content type', () => {
    // Some proxies serve JSON as text/plain, so the bytes are what count.
    expect(parseJsonBody<string[]>('["api","worker"]')).toEqual({
      ok: true,
      value: ['api', 'worker'],
    });
  });

  it('reports failure for an HTML page instead of throwing', () => {
    expect(parseJsonBody('<!DOCTYPE html><html></html>')).toEqual({
      ok: false,
    });
  });

  it('reports failure for an empty or whitespace-only body', () => {
    expect(parseJsonBody('')).toEqual({ ok: false });
    expect(parseJsonBody('   \n  ')).toEqual({ ok: false });
  });

  it('reports failure for truncated JSON', () => {
    // A connection cut mid-response is a backend fault, not a caller mistake.
    expect(parseJsonBody('{"status":"succ')).toEqual({ ok: false });
  });
});

describe('summarizeBody', () => {
  it('collapses whitespace onto a single line', () => {
    const summary = summarizeBody(
      '<html>\n  <body>\n    Bad Gateway\n  </body>\n</html>',
    );

    expect(summary).toBe('<html> <body> Bad Gateway </body> </html>');
    expect(summary).not.toContain('\n');
  });

  it('truncates beyond the cap and marks the cut', () => {
    const summary = summarizeBody('x'.repeat(500));

    expect(summary).toHaveLength(201);
    expect(summary.endsWith('…')).toBe(true);
  });

  it('honours an explicit cap', () => {
    expect(summarizeBody('abcdefghij', 4)).toBe('abcd…');
  });

  it('keeps a body that fits unchanged', () => {
    expect(summarizeBody('Bad Gateway', 200)).toBe('Bad Gateway');
  });

  it('names an empty body so the message is not blank', () => {
    expect(summarizeBody('')).toBe('<empty body>');
    expect(summarizeBody('  \t ')).toBe('<empty body>');
  });
});
