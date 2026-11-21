import { Result } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { selectOrganization } from '../server/account';
import { NEON_HANDLERS } from '../tools/tools';
import type { ToolHandlerExtraParams } from '../tools/types';
import { runToolHandler } from './helpers/run-tool-handler';

const consoleOrg = {
  id: 'org-console',
  name: 'Acme',
  managed_by: 'console',
};

const USER = { id: 'user-1', name: 'Ada' };

function extra(
  account: ToolHandlerExtraParams['account'] = USER,
): ToolHandlerExtraParams {
  return {
    account,
    clientApplication: 'unknown',
    apiKey: 'napi_test',
  };
}

function requestUrl(input: string | URL | Request): URL {
  return new URL(input instanceof Request ? input.url : input);
}

// The Neon API as the org lookup and list_projects see it.
function stubNeonApi(organizations = [consoleOrg]) {
  const fetchMock = vi.fn(async (input: string | URL | Request) =>
    Response.json(
      requestUrl(input).pathname.endsWith('/users/me/organizations')
        ? { organizations }
        : { projects: [] },
    ),
  );
  vi.stubGlobal('fetch', fetchMock);

  return {
    organizationLookups: () =>
      fetchMock.mock.calls.filter(([input]) =>
        requestUrl(input).pathname.endsWith('/users/me/organizations'),
      ).length,
    projectsUrl: () => {
      const call = fetchMock.mock.calls.find(([input]) =>
        requestUrl(input).pathname.endsWith('/projects'),
      );
      return call === undefined ? undefined : requestUrl(call[0]).search;
    },
  };
}

describe('selectOrganization', () => {
  it('selects the only console org', () => {
    expect(selectOrganization([consoleOrg])).toEqual(
      Result.succeed({ id: 'org-console' }),
    );
  });

  it('lists orgs when there is more than one', () => {
    const selected = selectOrganization([
      consoleOrg,
      { id: 'org-other', name: 'Other', managed_by: 'console' },
    ]);

    expect(Result.isFailure(selected)).toBe(true);
    expect(Result.getOrElse(selected, (message) => message)).toMatch(
      /org-console/u,
    );
  });

  it('fails when there are no orgs', () => {
    expect(selectOrganization([])).toEqual(
      Result.fail('No organizations found for this user'),
    );
  });
});

describe('list_projects generated handler', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('puts org_id on GET /projects for a billed personal key', async () => {
    const neon = stubNeonApi();

    await runToolHandler(
      NEON_HANDLERS.list_projects({ params: { limit: 20 } }, extra()),
    );

    expect(neon.projectsUrl()).toContain('org_id=org-console');
    expect(neon.organizationLookups()).toBe(1);
  });

  it('sends an explicit org_id without looking up organizations', async () => {
    const neon = stubNeonApi();

    await runToolHandler(
      NEON_HANDLERS.list_projects(
        { params: { limit: 20, org_id: 'org-explicit' } },
        extra(),
      ),
    );

    expect(neon.organizationLookups()).toBe(0);
    expect(neon.projectsUrl()).toContain('org_id=org-explicit');
  });

  it('uses the org API key account id without looking up organizations', async () => {
    const neon = stubNeonApi();

    await runToolHandler(
      NEON_HANDLERS.list_projects(
        { params: { limit: 20 } },
        extra({ id: 'org-from-key', name: 'Org Key', isOrg: true }),
      ),
    );

    expect(neon.organizationLookups()).toBe(0);
    expect(neon.projectsUrl()).toContain('org_id=org-from-key');
  });
});
