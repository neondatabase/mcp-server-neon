import type { OpenApiSpec } from '@neon/sdk/openapi';
import { describe, expect, it } from 'vitest';
import { callApiRoute } from '../analytics/api-routes';

const spec: OpenApiSpec = {
  paths: {
    '/projects/{project_id}/branches/{branch_id}/roles/{role_name}': {
      get: { operationId: 'getProjectBranchRole' },
    },
    '/projects/{project_id}': { delete: { operationId: 'deleteProject' } },
  },
};

describe('callApiRoute', () => {
  it('maps a concrete path, including an encoded name, to its template', () => {
    expect(
      callApiRoute(
        { method: 'GET', path: '/projects/p-1/branches/br-1/roles/app%20user' },
        spec,
      ),
    ).toStrictEqual({
      apiMethod: 'GET',
      apiRoute: '/projects/{project_id}/branches/{branch_id}/roles/{role_name}',
    });
  });

  it('reports unmatched for an unknown route, a method the route lacks, or a refused path', () => {
    expect(
      [
        callApiRoute({ method: 'GET', path: '/organizations/org-1/x' }, spec),
        callApiRoute({ method: 'POST', path: '/projects/p-1' }, spec),
        callApiRoute({ method: 'GET', path: '/projects/../users/me' }, spec),
      ].map((route) => route.apiRoute),
    ).toStrictEqual(['unmatched', 'unmatched', 'unmatched']);
  });

  it('reports spec_unavailable only for a path call_api accepts', () => {
    expect(
      callApiRoute({ method: 'DELETE', path: '/projects/p-1' }, undefined),
    ).toStrictEqual({ apiMethod: 'DELETE', apiRoute: 'spec_unavailable' });
    expect(
      callApiRoute({ method: 'DELETE', path: '/projects/../x' }, undefined),
    ).toStrictEqual({ apiMethod: 'DELETE', apiRoute: 'unmatched' });
  });
});
