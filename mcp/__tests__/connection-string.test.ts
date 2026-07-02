import { describe, it, expect, vi } from 'vitest';
import { EndpointType } from '@neondatabase/api-client';
import { InvalidArgumentError } from '../server/errors';
import { handleGetConnectionString } from '../tools/handlers/connection-string';
import type { ToolHandlerExtraParams } from '../tools/types';

const READ_ONLY_REPLICA_ERROR =
  'this MCP server is in read-only mode and no read replica endpoint can be found - create a read replica first using the Neon UI to enable get_connection_string in read-only mode or remove the read-only mode configuration (HTTP header, OAuth scope settings)';

describe('handleGetConnectionString', () => {
  it('uses read-only endpoint in read-only mode', async () => {
    const neonClient = {
      listProjectBranchEndpoints: vi.fn().mockResolvedValue({
        data: {
          endpoints: [
            {
              id: 'ep-read-write',
              type: EndpointType.ReadWrite,
              disabled: false,
            },
            {
              id: 'ep-read-only',
              type: EndpointType.ReadOnly,
              disabled: false,
            },
          ],
        },
      }),
      getConnectionUri: vi.fn().mockResolvedValue({
        data: { uri: 'postgresql://example' },
      }),
    };

    const result = await handleGetConnectionString(
      {
        projectId: 'project-1',
        branchId: 'branch-1',
        databaseName: 'neondb',
        roleName: 'neondb_owner',
      },
      neonClient as unknown as Parameters<typeof handleGetConnectionString>[1],
      { readOnly: true } as ToolHandlerExtraParams,
      { enforceReadOnlyReplica: true },
    );

    expect(neonClient.listProjectBranchEndpoints).toHaveBeenCalledWith(
      'project-1',
      'branch-1',
    );
    expect(neonClient.getConnectionUri).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        branch_id: 'branch-1',
        endpoint_id: 'ep-read-only',
        database_name: 'neondb',
        role_name: 'neondb_owner',
      }),
    );
    expect(result.computeId).toBe('ep-read-only');
  });

  it('fails in read-only mode when no read replica endpoint exists', async () => {
    const neonClient = {
      listProjectBranchEndpoints: vi.fn().mockResolvedValue({
        data: {
          endpoints: [
            {
              id: 'ep-read-write',
              type: EndpointType.ReadWrite,
              disabled: false,
            },
          ],
        },
      }),
      getConnectionUri: vi.fn(),
    };

    await expect(
      handleGetConnectionString(
        {
          projectId: 'project-1',
          branchId: 'branch-1',
          databaseName: 'neondb',
          roleName: 'neondb_owner',
        },
        neonClient as unknown as Parameters<
          typeof handleGetConnectionString
        >[1],
        { readOnly: true } as ToolHandlerExtraParams,
        { enforceReadOnlyReplica: true },
      ),
    ).rejects.toThrow(new InvalidArgumentError(READ_ONLY_REPLICA_ERROR));

    expect(neonClient.getConnectionUri).not.toHaveBeenCalled();
  });

  it('keeps regular endpoint behavior outside read-only mode', async () => {
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
        endpoint_id: 'ep-explicit',
      }),
    );
    expect(result.computeId).toBe('ep-explicit');
  });

  it('does not require a read replica for non-connection-string consumers in read-only mode', async () => {
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
