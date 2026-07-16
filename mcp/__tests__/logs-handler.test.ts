/**
 * Unit tests for the logs tool handlers, exercised through NEON_HANDLERS with a
 * mocked Neon API client. Asserts the telemetry request (URL, query params) and the
 * shaped response.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Api } from '@neondatabase/api-client';
import { NEON_HANDLERS } from '../tools/tools';

type ToolResult = { content: Array<{ type: string; text: string }> };

const extra = {
  account: { id: 'acc-1' },
} as unknown as Parameters<typeof NEON_HANDLERS.query_logs>[2];

function mockClient(requestImpl: ReturnType<typeof vi.fn>) {
  return {
    request: requestImpl,
    listProjectBranches: vi.fn().mockResolvedValue({
      status: 200,
      data: { branches: [{ id: 'br-default', default: true }] },
    }),
    listProjects: vi.fn().mockResolvedValue({
      status: 200,
      data: { projects: [{ id: 'proj-only' }] },
    }),
    // getOnlyProject → handleListProjects → getOrgByOrgIdOrDefault. A personal
    // (billing_account) user short-circuits org resolution to a plain listProjects.
    getCurrentUserInfo: vi.fn().mockResolvedValue({
      status: 200,
      data: { billing_account: { id: 'ba-1' } },
    }),
  } as unknown as Api<unknown>;
}

describe('query_logs handler', () => {
  it('builds a query_range request from structured filters and shapes the response', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        status: 'success',
        data: {
          resultType: 'streams',
          result: [
            {
              stream: { service_name: 'api', severity_text: 'ERROR' },
              values: [['1700000000000000000', 'boom']],
            },
          ],
        },
      },
    });
    const client = mockClient(request);

    const result = (await NEON_HANDLERS.query_logs(
      {
        params: {
          projectId: 'proj-1',
          branchId: 'br-1',
          source: 'function',
          serviceName: 'api',
          minSeverity: 'error',
          since: '2h',
          limit: 50,
        },
      },
      client,
      extra,
    )) as ToolResult;

    expect(request).toHaveBeenCalledTimes(1);
    const call = request.mock.calls[0][0];
    expect(call.method).toBe('GET');
    expect(call.secure).toBe(true);
    expect(call.path).toBe(
      'https://console.neon.tech/telemetry/v1/projects/proj-1/branches/br-1/loki/api/v1/query_range',
    );
    expect(call.query.query).toBe(
      '{entity_type="function", service_name="api", severity_text=~"(?i)(ERROR|FATAL)[0-9]*"}',
    );
    expect(call.query.since).toBe('2h');
    expect(call.query.limit).toBe(50);
    expect(call.query.direction).toBe('backward');

    const payload = JSON.parse(result.content[0].text);
    expect(payload.count).toBe(1);
    expect(payload.records[0].body).toBe('boom');
    expect(payload.records[0].serviceName).toBe('api');
    expect(payload.scope).toEqual({ projectId: 'proj-1', branchId: 'br-1' });
  });

  it('resolves the default branch and defaults to a 1h window when omitted', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        status: 'success',
        data: { resultType: 'streams', result: [] },
      },
    });
    const client = mockClient(request);

    await NEON_HANDLERS.query_logs(
      { params: { projectId: 'proj-1', source: 'function', limit: 100 } },
      client,
      extra,
    );

    const call = request.mock.calls[0][0];
    expect(call.path).toContain('/branches/br-default/');
    // No since/startTime given → default 1h relative window.
    expect(call.query.since).toBe('1h');
    expect(call.query.start).toBeUndefined();
  });

  it('resolves the only project when projectId is omitted', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        status: 'success',
        data: { resultType: 'streams', result: [] },
      },
    });
    const client = mockClient(request);

    await NEON_HANDLERS.query_logs(
      { params: { source: 'function', limit: 100 } },
      client,
      extra,
    );

    const call = request.mock.calls[0][0];
    expect(call.path).toContain('/projects/proj-only/');
  });

  it('passes a raw LogQL query through unchanged and uses absolute time', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        status: 'success',
        data: { resultType: 'streams', result: [] },
      },
    });
    const client = mockClient(request);

    await NEON_HANDLERS.query_logs(
      {
        params: {
          projectId: 'proj-1',
          branchId: 'br-1',
          source: 'function',
          query: '{entity_type="function"} |~ "(?i)timeout"',
          startTime: '2026-07-16T09:00:00Z',
          endTime: '2026-07-16T10:00:00Z',
          limit: 100,
        },
      },
      client,
      extra,
    );

    const call = request.mock.calls[0][0];
    expect(call.query.query).toBe('{entity_type="function"} |~ "(?i)timeout"');
    expect(call.query.start).toBe('2026-07-16T09:00:00Z');
    expect(call.query.end).toBe('2026-07-16T10:00:00Z');
    expect(call.query.since).toBeUndefined();
  });

  it('surfaces the Loki error message as a client error on a non-2xx response', async () => {
    // The real client uses validateStatus: () => true, so a 4xx RESOLVES with the
    // Loki error body; assertOk throws an InvalidArgumentError carrying the message.
    const request = vi.fn().mockResolvedValue({
      status: 400,
      data: { status: 'error', error: 'missing query' },
    });
    const client = mockClient(request);

    await expect(
      NEON_HANDLERS.query_logs(
        {
          params: {
            projectId: 'proj-1',
            branchId: 'br-1',
            source: 'function',
            limit: 100,
          },
        },
        client,
        extra,
      ),
    ).rejects.toThrow(/missing query/);
    // validateStatus is set so axios does not itself reject on 4xx.
    expect(request.mock.calls[0][0].validateStatus).toBeTypeOf('function');
  });

  it('raises a backend error (not a client error) on a 5xx response', async () => {
    // 5xx is a telemetry-backend fault: a plain Error so handleToolError captures
    // it to Sentry, rather than an InvalidArgumentError swallowed as a client error.
    const { InvalidArgumentError } = await import('../server/errors');
    const request = vi.fn().mockResolvedValue({
      status: 502,
      data: { status: 'error', error: 'telemetry backend unavailable' },
    });
    const client = mockClient(request);

    await expect(
      NEON_HANDLERS.query_logs(
        {
          params: {
            projectId: 'proj-1',
            branchId: 'br-1',
            source: 'function',
            limit: 100,
          },
        },
        client,
        extra,
      ),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof Error &&
        !(e instanceof InvalidArgumentError) &&
        /telemetry backend unavailable/.test(e.message),
    );
  });
});

describe('list_log_fields / list_log_field_values handlers', () => {
  it('lists advertised fields', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        status: 'success',
        data: ['service_name', 'severity_text', 'scope_name', 'entity_type'],
      },
    });
    const client = mockClient(request);

    const result = (await NEON_HANDLERS.list_log_fields(
      { params: { projectId: 'proj-1', branchId: 'br-1' } },
      client,
      extra,
    )) as ToolResult;

    const call = request.mock.calls[0][0];
    expect(call.path).toContain('/loki/api/v1/labels');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.fields).toContain('severity_text');
  });

  it('lists values for a field with a since window', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: { status: 'success', data: ['api', 'worker'] },
    });
    const client = mockClient(request);

    const result = (await NEON_HANDLERS.list_log_field_values(
      {
        params: {
          projectId: 'proj-1',
          branchId: 'br-1',
          field: 'service_name',
          since: '24h',
        },
      },
      client,
      extra,
    )) as ToolResult;

    const call = request.mock.calls[0][0];
    expect(call.path).toContain('/loki/api/v1/label/service_name/values');
    expect(call.query.since).toBe('24h');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.field).toBe('service_name');
    expect(payload.values).toEqual(['api', 'worker']);
  });
});
