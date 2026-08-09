/**
 * Unit tests for the logs tool handlers, exercised through NEON_HANDLERS with a
 * stubbed Neon client facade. Asserts what the handlers ask `neon.logs.*` for —
 * the camelCase-to-snake_case mapping, the defaults, the mutually exclusive
 * windows — and the shape they return.
 *
 * What actually reaches the wire, and how a 4xx/5xx is classified, is covered by
 * logs-tools.integration.test.ts against a real client.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Api, ProjectBranchLogRecord } from '../neon-client';
import { InvalidArgumentError } from '../server/errors';
import { NEON_HANDLERS } from '../tools/tools';

type ToolResult = { content: Array<{ type: string; text: string }> };

const extra = {
  account: { id: 'acc-1' },
} as unknown as Parameters<typeof NEON_HANDLERS.query_logs>[2];

type LogsStub = {
  queryLogs?: ReturnType<typeof vi.fn>;
  listLogFields?: ReturnType<typeof vi.fn>;
  listLogFieldValues?: ReturnType<typeof vi.fn>;
};

function mockClient(logs: LogsStub) {
  return {
    ...logs,
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

function page(items: ProjectBranchLogRecord[], cursor?: string) {
  return vi.fn().mockResolvedValue({ items, cursor });
}

function payloadOf(result: ToolResult) {
  return JSON.parse(result.content[0].text);
}

describe('query_logs handler', () => {
  it('renders structured filters as the executed LogQL query and shapes the response', async () => {
    const queryLogs = page([
      {
        timestamp: '2023-11-14T22:13:20Z',
        message: 'boom',
        source: 'function',
        service_name: 'api',
        scope_name: 'handler',
        severity_text: 'ERROR',
        severity_number: 17,
        entity_id: 'fn-1',
        trace_id: 'abc123',
        attributes: { region: 'aws-us-east-2' },
      },
    ]);
    const client = mockClient({ queryLogs });

    const result = (await NEON_HANDLERS.query_logs(
      {
        params: {
          projectId: 'proj-1',
          branchId: 'br-1',
          source: 'function',
          serviceName: 'api',
          minSeverity: 'error',
          bodyContains: 'boom',
          traceId: 'abc123',
          since: '2h',
          limit: 50,
        },
      },
      client,
      extra,
    )) as ToolResult;

    expect(queryLogs).toHaveBeenCalledTimes(1);
    expect(queryLogs).toHaveBeenCalledWith('proj-1', 'br-1', {
      logql:
        '{entity_type="function", service_name="api", trace_id="abc123", severity_text=~"(?i)(ERROR|FATAL)[0-9]*"} |= "boom"',
      since: '2h',
      limit: 50,
      sort_order: 'desc',
    });

    const payload = payloadOf(result);
    expect(payload.scope).toEqual({ projectId: 'proj-1', branchId: 'br-1' });
    expect(payload.query).toBe(
      '{entity_type="function", service_name="api", trace_id="abc123", severity_text=~"(?i)(ERROR|FATAL)[0-9]*"} |= "boom"',
    );
    expect(payload.count).toBe(1);
    expect(payload.truncated).toBe(false);
    // The SDK-only fields (severity_number, entity_id, trace_id, attributes) are
    // intentionally dropped; source becomes entityType.
    expect(payload.records).toEqual([
      {
        timestamp: '2023-11-14T22:13:20.000Z',
        severity: 'ERROR',
        serviceName: 'api',
        scopeName: 'handler',
        entityType: 'function',
        body: 'boom',
      },
    ]);
  });

  it('prefers an exact severityText over minSeverity', async () => {
    const queryLogs = page([]);
    const client = mockClient({ queryLogs });

    await NEON_HANDLERS.query_logs(
      {
        params: {
          projectId: 'proj-1',
          branchId: 'br-1',
          source: 'function',
          severityText: 'WARN',
          minSeverity: 'error',
          limit: 100,
        },
      },
      client,
      extra,
    );

    expect(queryLogs.mock.calls[0][2]).toMatchObject({
      logql: '{entity_type="function", severity_text="WARN"}',
    });
  });

  it('resolves the default branch and defaults to a 1h window when omitted', async () => {
    const queryLogs = page([]);
    const client = mockClient({ queryLogs });

    await NEON_HANDLERS.query_logs(
      { params: { projectId: 'proj-1', source: 'function', limit: 100 } },
      client,
      extra,
    );

    const [, branchId, input] = queryLogs.mock.calls[0];
    expect(branchId).toBe('br-default');
    expect(input.since).toBe('1h');
    expect(input.start_time).toBeUndefined();
  });

  it('resolves the only project when projectId is omitted', async () => {
    const queryLogs = page([]);
    const client = mockClient({ queryLogs });

    await NEON_HANDLERS.query_logs(
      { params: { source: 'function', limit: 100 } },
      client,
      extra,
    );

    expect(queryLogs.mock.calls[0][0]).toBe('proj-only');
  });

  it('uses an absolute window instead of since when startTime is given', async () => {
    const queryLogs = page([]);
    const client = mockClient({ queryLogs });

    await NEON_HANDLERS.query_logs(
      {
        params: {
          projectId: 'proj-1',
          branchId: 'br-1',
          source: 'function',
          since: '2h',
          startTime: '2026-07-16T09:00:00Z',
          endTime: '2026-07-16T10:00:00Z',
          limit: 100,
        },
      },
      client,
      extra,
    );

    expect(queryLogs.mock.calls[0][2]).toMatchObject({
      start_time: '2026-07-16T09:00:00Z',
      end_time: '2026-07-16T10:00:00Z',
    });
    // Sending both bounds and a relative window is rejected by the API.
    expect(queryLogs.mock.calls[0][2].since).toBeUndefined();
  });

  it('uses endTime as the endpoint for a relative window', async () => {
    const queryLogs = page([]);
    const client = mockClient({ queryLogs });

    await NEON_HANDLERS.query_logs(
      {
        params: {
          projectId: 'proj-1',
          branchId: 'br-1',
          source: 'function',
          since: '2h',
          endTime: '2026-07-16T10:00:00Z',
          limit: 100,
        },
      },
      client,
      extra,
    );

    expect(queryLogs.mock.calls[0][2]).toMatchObject({
      since: '2h',
      end_time: '2026-07-16T10:00:00Z',
    });
  });

  it('sends raw logql alone, without the defaulted source', async () => {
    const queryLogs = page([]);
    const client = mockClient({ queryLogs });

    const result = (await NEON_HANDLERS.query_logs(
      {
        params: {
          projectId: 'proj-1',
          branchId: 'br-1',
          source: 'function',
          serviceName: 'api',
          minSeverity: 'error',
          logql: '{entity_type="function"} |~ "(?i)timeout"',
          limit: 100,
        },
      },
      client,
      extra,
    )) as ToolResult;

    // Structured filters alongside logql are rejected as conflicting_filters.
    expect(queryLogs).toHaveBeenCalledWith('proj-1', 'br-1', {
      logql: '{entity_type="function"} |~ "(?i)timeout"',
      since: '1h',
      limit: 100,
      sort_order: 'desc',
    });
    expect(payloadOf(result).query).toBe(
      '{entity_type="function"} |~ "(?i)timeout"',
    );
  });

  it('keeps query as a compatibility alias for logql', async () => {
    const queryLogs = page([]);
    const client = mockClient({ queryLogs });

    await NEON_HANDLERS.query_logs(
      {
        params: {
          projectId: 'proj-1',
          branchId: 'br-1',
          source: 'function',
          query: '{entity_type="storage"} |= "uploaded"',
          limit: 100,
        },
      },
      client,
      extra,
    );

    expect(queryLogs.mock.calls[0][2]).toMatchObject({
      logql: '{entity_type="storage"} |= "uploaded"',
    });
  });

  it('rejects logql and query together before resolving scope', async () => {
    const queryLogs = page([]);
    const client = mockClient({ queryLogs });

    await expect(
      NEON_HANDLERS.query_logs(
        {
          params: {
            source: 'function',
            logql: '{entity_type="function"}',
            query: '{entity_type="storage"}',
            limit: 100,
          },
        },
        client,
        extra,
      ),
    ).rejects.toThrow(InvalidArgumentError);

    expect(queryLogs).not.toHaveBeenCalled();
    expect(client.listProjects).not.toHaveBeenCalled();
  });

  it('reports truncation when the page carries a cursor', async () => {
    const queryLogs = page(
      [
        {
          timestamp: '2023-11-14T22:13:20.000Z',
          message: 'first',
          attributes: {},
        },
      ],
      'cursor-1',
    );
    const client = mockClient({ queryLogs });

    const result = (await NEON_HANDLERS.query_logs(
      {
        params: {
          projectId: 'proj-1',
          branchId: 'br-1',
          source: 'function',
          limit: 1,
        },
      },
      client,
      extra,
    )) as ToolResult;

    const payload = payloadOf(result);
    expect(payload.truncated).toBe(true);
    expect(payload.count).toBe(1);
  });

  it('propagates a failure from the logs query unchanged', async () => {
    const queryLogs = vi
      .fn()
      .mockRejectedValue(new Error('logs are not available for this branch'));
    const client = mockClient({ queryLogs });

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
    ).rejects.toThrow(/logs are not available for this branch/);
  });
});

describe('list_log_fields / list_log_field_values handlers', () => {
  it('lists the fields reported for the branch', async () => {
    const listLogFields = vi
      .fn()
      .mockResolvedValue(['service_name', 'severity_text', 'entity_type']);
    const client = mockClient({ listLogFields });

    const result = (await NEON_HANDLERS.list_log_fields(
      { params: { projectId: 'proj-1', branchId: 'br-1' } },
      client,
      extra,
    )) as ToolResult;

    expect(listLogFields).toHaveBeenCalledWith('proj-1', 'br-1');
    const payload = payloadOf(result);
    expect(payload.scope).toEqual({ projectId: 'proj-1', branchId: 'br-1' });
    expect(payload.fields).toContain('severity_text');
  });

  it('lists values for a field with a since window', async () => {
    const listLogFieldValues = vi
      .fn()
      .mockResolvedValue({ values: ['api', 'worker'], is_truncated: false });
    const client = mockClient({ listLogFieldValues });

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

    expect(listLogFieldValues).toHaveBeenCalledWith(
      'proj-1',
      'br-1',
      'service_name',
      { since: '24h' },
    );
    expect(payloadOf(result)).toEqual({
      scope: { projectId: 'proj-1', branchId: 'br-1' },
      field: 'service_name',
      values: ['api', 'worker'],
      truncated: false,
    });
  });

  it('leaves the window to the server when since is omitted', async () => {
    const listLogFieldValues = vi
      .fn()
      .mockResolvedValue({ values: [], is_truncated: false });
    const client = mockClient({ listLogFieldValues });

    await NEON_HANDLERS.list_log_field_values(
      { params: { projectId: 'proj-1', branchId: 'br-1', field: 'entity_id' } },
      client,
      extra,
    );

    expect(listLogFieldValues).toHaveBeenCalledWith(
      'proj-1',
      'br-1',
      'entity_id',
      undefined,
    );
  });

  it('surfaces a truncated value list', async () => {
    const listLogFieldValues = vi
      .fn()
      .mockResolvedValue({ values: ['api'], is_truncated: true });
    const client = mockClient({ listLogFieldValues });

    const result = (await NEON_HANDLERS.list_log_field_values(
      {
        params: {
          projectId: 'proj-1',
          branchId: 'br-1',
          field: 'service_name',
        },
      },
      client,
      extra,
    )) as ToolResult;

    expect(payloadOf(result).truncated).toBe(true);
  });
});
