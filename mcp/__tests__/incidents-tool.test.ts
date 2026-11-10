/**
 * Unit tests for the list_incidents tool handler.
 *
 * Mocks global fetch, since the handler reads the neonstatus.com API.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { assert } from '../../lib/assert';
import { NEON_HANDLERS } from '../tools/tools';

type ToolResult = { content: Array<{ type: string; text: string }> };

const originalFetch = globalThis.fetch;

const STATUS_URL = 'https://api.status.io/1.0/status/6878fc85709daa75be6c7e3c';

const OPERATIONAL = {
  result: {
    status_overall: {
      updated: '2026-11-02T22:27:18.595Z',
      status: 'Operational',
      status_code: 100,
    },
    status: [],
    incidents: [],
    maintenance: { active: [], upcoming: [] },
  },
};

describe('list_incidents handler', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns the neonstatus.com report without a credential', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify(OPERATIONAL)),
    );

    const result = (await NEON_HANDLERS.list_incidents({
      params: {},
    })) as ToolResult;

    expect(JSON.parse(result.content[0].text)).toEqual({
      status: 'operational',
      updated_at: '2026-11-02T22:27:18.595Z',
      status_page_url: 'https://neonstatus.com',
      incidents: [],
      maintenance: [],
      affected_components: [],
    });
    const [request] = vi.mocked(globalThis.fetch).mock.calls[0];
    assert(request instanceof Request, 'fetch was not called with a Request');
    expect(request.url).toBe(STATUS_URL);
    expect(request.headers.has('authorization')).toBe(false);
  });

  it('rejects arguments', async () => {
    await expect(
      NEON_HANDLERS.list_incidents({ params: { region: 'aws-us-east-2' } }),
    ).rejects.toThrow();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('surfaces a status page failure', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('unavailable', { status: 503 }),
    );

    await expect(NEON_HANDLERS.list_incidents({ params: {} })).rejects.toThrow(
      'neonstatus.com returned HTTP 503.',
    );
  });
});
