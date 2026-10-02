import { describe, expect, it, vi } from 'vitest';
import { handleSearch } from '../tools/handlers/search';
import type { ToolHandlerExtraParams } from '../tools/types';

const personalAccount = {
  account: { id: 'user-1', name: 'Ada', isOrg: false },
  apiKey: 'napi_test',
} as ToolHandlerExtraParams;

function neonClient(
  organizations: { id: string; name: string; managed_by: string }[],
) {
  const projectsByOrg: Record<string, { id: string; name: string }[]> = {
    'org-acme': [{ id: 'acme-app', name: 'acme app' }],
    'org-side': [{ id: 'side-app', name: 'side app' }],
  };
  return {
    getCurrentUserOrganizations: vi.fn().mockResolvedValue({
      data: { organizations },
    }),
    listProjects: vi.fn(({ org_id }: { org_id: string }) =>
      Promise.resolve({
        status: 200,
        statusText: 'OK',
        data: { projects: projectsByOrg[org_id] ?? [] },
      }),
    ),
    listProjectBranches: vi.fn().mockResolvedValue({
      data: { branches: [] },
    }),
    listSharedProjects: vi.fn().mockResolvedValue({
      data: { projects: [] },
    }),
  };
}

function resultIds(result: Awaited<ReturnType<typeof handleSearch>>) {
  expect(result.isError).toBeFalsy();
  const text = (result.content[0] as { text: string }).text;
  return (JSON.parse(text) as { id: string }[]).map((r) => r.id);
}

describe('search with a personal account', () => {
  it('searches every organization when the account belongs to several', async () => {
    const client = neonClient([
      { id: 'org-acme', name: 'Acme', managed_by: 'console' },
      { id: 'org-side', name: 'Side', managed_by: 'console' },
    ]);

    const result = await handleSearch(
      { query: 'app' },
      client as never,
      personalAccount,
    );

    expect(resultIds(result)).toEqual(['project:acme-app', 'project:side-app']);
  });

  it('returns each project once when the account has one organization', async () => {
    const client = neonClient([
      { id: 'org-acme', name: 'Acme', managed_by: 'console' },
    ]);

    const result = await handleSearch(
      { query: 'app' },
      client as never,
      personalAccount,
    );

    expect(resultIds(result)).toEqual(['project:acme-app']);
  });
});
