import { describe, it, expect, vi } from 'vitest';
import type { Api } from '../neon-client';
import { InvalidArgumentError } from '../server/errors';
import { handleGetConnectionString } from '../tools/handlers/connection-string';
import { NEON_HANDLERS } from '../tools/tools';
import type { ToolHandlerExtraParams } from '../tools/types';

describe('handleGetConnectionString', () => {
  it('uses the requested endpoint outside read-only mode', async () => {
    const neonClient = {
      listProjectBranchEndpoints: vi.fn(),
      getConnectionUri: vi.fn().mockResolvedValue({
        data: { uri: 'postgresql://example' },
      }),
    };

    const result = await handleGetConnectionString(
      {
        projectId: 'project-1',
        branchId: 'branch-1',
        computeId: 'ep-explicit',
        databaseName: 'neondb',
        roleName: 'neondb_owner',
      },
      neonClient as unknown as Parameters<typeof handleGetConnectionString>[1],
      { readOnly: false } as ToolHandlerExtraParams,
    );

    expect(neonClient.listProjectBranchEndpoints).not.toHaveBeenCalled();
    expect(neonClient.getConnectionUri).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        branch_id: 'branch-1',
        endpoint_id: 'ep-explicit',
        database_name: 'neondb',
        role_name: 'neondb_owner',
      }),
    );
    expect(result.computeId).toBe('ep-explicit');
  });

  it('uses the requested endpoint in read-only mode for internal consumers', async () => {
    // Internal callers (run_sql, get_database_tables, inspect_database, ...)
    // need a working connection even in read-only mode; they are kept safe by
    // read-only transactions and never surface the URI to the client. Only the
    // `get_connection_string` tool is withheld — see the tool-layer test below.
    const neonClient = {
      listProjectBranchEndpoints: vi.fn(),
      getConnectionUri: vi.fn().mockResolvedValue({
        data: { uri: 'postgresql://example' },
      }),
    };

    const result = await handleGetConnectionString(
      {
        projectId: 'project-1',
        branchId: 'branch-1',
        computeId: 'ep-read-write',
        databaseName: 'neondb',
        roleName: 'neondb_owner',
      },
      neonClient as unknown as Parameters<typeof handleGetConnectionString>[1],
      { readOnly: true } as ToolHandlerExtraParams,
    );

    expect(neonClient.listProjectBranchEndpoints).not.toHaveBeenCalled();
    expect(neonClient.getConnectionUri).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint_id: 'ep-read-write',
      }),
    );
    expect(result.computeId).toBe('ep-read-write');
  });
});

describe('get_connection_string tool in read-only mode', () => {
  // Second layer behind the `readOnlySafe: false` filter, which already keeps
  // the tool unregistered on a read-only server. Asserted here so the guarantee
  // does not depend on registration-time filtering alone.
  it('refuses without asking the API for a connection string', async () => {
    const neonClient = {
      getConnectionUri: vi.fn(),
    } as unknown as Api<unknown>;

    const error = await NEON_HANDLERS.get_connection_string(
      { params: { projectId: 'project-1' } },
      neonClient,
      {
        account: { id: 'acc-1' },
        readOnly: true,
      } as unknown as Parameters<typeof NEON_HANDLERS.get_connection_string>[2],
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InvalidArgumentError);
    expect((error as Error).message).toContain('read-only mode');
    expect(neonClient.getConnectionUri).not.toHaveBeenCalled();
  });
});
