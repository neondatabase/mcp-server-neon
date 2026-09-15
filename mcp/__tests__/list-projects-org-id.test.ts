import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../server/errors';
import { handleListProjects } from '../tools/handlers/list-projects';
import { NEON_HANDLERS } from '../tools/tools';
import type { ToolHandlerExtraParams } from '../tools/types';
import { getOrgByOrgIdOrDefault } from '../tools/utils';

const consoleOrg = {
  id: 'org-console',
  name: 'Acme',
  managed_by: 'console' as const,
};

function extra(
  account: ToolHandlerExtraParams['account'] = {
    id: 'user-1',
    name: 'Ada',
  },
): ToolHandlerExtraParams {
  return {
    account,
    apiKey: 'napi_test',
  } as ToolHandlerExtraParams;
}

function billedUserClient(organizations = [consoleOrg]) {
  return {
    getCurrentUserOrganizations: vi.fn().mockResolvedValue({
      data: { organizations },
    }),
    listProjects: vi.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      data: { projects: [] },
    }),
  };
}

function requestUrl(call: unknown[]): string {
  const first = call[0];
  if (first instanceof Request) {
    return first.url;
  }
  return String(first);
}

describe('getOrgByOrgIdOrDefault', () => {
  it('selects the console org for a billed personal key', async () => {
    const neonClient = billedUserClient();

    await expect(
      getOrgByOrgIdOrDefault({}, neonClient as never, extra()),
    ).resolves.toMatchObject({ id: 'org-console' });
    expect(neonClient.getCurrentUserOrganizations).toHaveBeenCalledOnce();
  });

  it('lists orgs when a billed personal key has more than one', async () => {
    const neonClient = billedUserClient([
      consoleOrg,
      { id: 'org-other', name: 'Other', managed_by: 'console' },
    ]);

    await expect(
      getOrgByOrgIdOrDefault({}, neonClient as never, extra()),
    ).rejects.toThrow(NotFoundError);
    await expect(
      getOrgByOrgIdOrDefault({}, neonClient as never, extra()),
    ).rejects.toThrow(/org-console/);
  });

  it('uses an explicit org_id without looking up organizations', async () => {
    const neonClient = billedUserClient();

    await expect(
      getOrgByOrgIdOrDefault(
        { org_id: 'org-explicit' },
        neonClient as never,
        extra(),
      ),
    ).resolves.toEqual({ id: 'org-explicit' });
    expect(neonClient.getCurrentUserOrganizations).not.toHaveBeenCalled();
  });

  it('uses the org API key account id without looking up organizations', async () => {
    const neonClient = billedUserClient();

    await expect(
      getOrgByOrgIdOrDefault(
        {},
        neonClient as never,
        extra({ id: 'org-from-key', name: 'Org Key', isOrg: true }),
      ),
    ).resolves.toEqual({ id: 'org-from-key' });
    expect(neonClient.getCurrentUserOrganizations).not.toHaveBeenCalled();
  });
});

describe('handleListProjects', () => {
  it('sends org_id for a billed personal key', async () => {
    const neonClient = billedUserClient();

    await handleListProjects({}, neonClient as never, extra());

    expect(neonClient.listProjects).toHaveBeenCalledWith(
      expect.objectContaining({ org_id: 'org-console' }),
    );
  });
});

describe('list_projects generated handler', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('puts org_id on GET /projects for a billed personal key', async () => {
    const neonClient = billedUserClient();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ projects: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await NEON_HANDLERS.list_projects(
      { params: { limit: 20 } },
      neonClient as never,
      extra(),
    );

    expect(fetchMock).toHaveBeenCalled();
    expect(requestUrl(fetchMock.mock.calls[0])).toContain('org_id=org-console');
    expect(neonClient.getCurrentUserOrganizations).toHaveBeenCalledOnce();
  });

  it('sends an explicit org_id without looking up organizations', async () => {
    const neonClient = billedUserClient();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ projects: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await NEON_HANDLERS.list_projects(
      { params: { limit: 20, org_id: 'org-explicit' } },
      neonClient as never,
      extra(),
    );

    expect(neonClient.getCurrentUserOrganizations).not.toHaveBeenCalled();
    expect(requestUrl(fetchMock.mock.calls[0])).toContain(
      'org_id=org-explicit',
    );
  });
});
