/**
 * Unit tests for the create_branch tool handler.
 *
 * Exercises NEON_HANDLERS.create_branch directly with a mocked Neon API client
 * and asserts the request body passed to createProjectBranch — specifically
 * that MCP-facing camelCase fields are forwarded to the Neon REST payload.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Api } from '@neondatabase/api-client';
import { EndpointType } from '@neondatabase/api-client';
import { NEON_HANDLERS } from '../tools/tools';

type ToolResult = {
  content: Array<{ type: string; text: string }>;
};

function mockNeonClient(
  parentId: string | undefined,
  expiresAt: string | undefined = undefined,
) {
  const createProjectBranch = vi.fn().mockResolvedValue({
    status: 201,
    statusText: 'Created',
    data: {
      branch: {
        id: 'br-new-branch-1',
        project_id: 'proj-1',
        name: 'feature-x',
        parent_id: parentId ?? 'br-default-1',
        expires_at: expiresAt,
      },
    },
  });
  return {
    client: { createProjectBranch } as unknown as Api<unknown>,
    createProjectBranch,
  };
}

describe('create_branch handler', () => {
  it('forwards parentId as branch.parent_id when provided', async () => {
    const { client, createProjectBranch } = mockNeonClient('br-dev-42');

    const result = (await NEON_HANDLERS.create_branch(
      {
        params: {
          projectId: 'proj-1',
          branchName: 'feature-x',
          parentId: 'br-dev-42',
        },
      },
      client,
    )) as ToolResult;

    expect(createProjectBranch).toHaveBeenCalledTimes(1);
    expect(createProjectBranch).toHaveBeenCalledWith('proj-1', {
      branch: {
        name: 'feature-x',
        parent_id: 'br-dev-42',
        expires_at: undefined,
      },
      endpoints: [
        {
          type: EndpointType.ReadWrite,
          autoscaling_limit_min_cu: 0.25,
          autoscaling_limit_max_cu: 0.25,
        },
      ],
    });
    expect(result.content[0].text).toContain('Branch ID: br-new-branch-1');
    expect(result.content[0].text).toContain('Parent branch: br-dev-42');
  });

  it('omits parent_id (default-branch fork) when parentId is not provided', async () => {
    const { client, createProjectBranch } = mockNeonClient(undefined);

    await NEON_HANDLERS.create_branch(
      {
        params: {
          projectId: 'proj-1',
          branchName: 'feature-y',
        },
      },
      client,
    );

    expect(createProjectBranch).toHaveBeenCalledTimes(1);
    const [, body] = createProjectBranch.mock.calls[0];
    expect(body.branch.name).toBe('feature-y');
    expect(body.branch.parent_id).toBeUndefined();
    expect(body.branch.expires_at).toBeUndefined();
  });

  it('forwards expiresAt as branch.expires_at when provided', async () => {
    const expiresAt = '2026-06-17T12:00:00Z';
    const { client, createProjectBranch } = mockNeonClient(
      undefined,
      expiresAt,
    );

    await NEON_HANDLERS.create_branch(
      {
        params: {
          projectId: 'proj-1',
          branchName: 'feature-z',
          expiresAt,
        },
      },
      client,
    );

    expect(createProjectBranch).toHaveBeenCalledTimes(1);
    const [, body] = createProjectBranch.mock.calls[0];
    expect(body.branch.name).toBe('feature-z');
    expect(body.branch.parent_id).toBeUndefined();
    expect(body.branch.expires_at).toBe(expiresAt);
  });

  it('throws when the API responds with a non-201 status', async () => {
    const createProjectBranch = vi.fn().mockResolvedValue({
      status: 403,
      statusText: 'Forbidden',
      data: {},
    });
    const client = { createProjectBranch } as unknown as Api<unknown>;

    await expect(
      NEON_HANDLERS.create_branch({ params: { projectId: 'proj-1' } }, client),
    ).rejects.toThrow(/Failed to create branch: Forbidden/);
  });
});
