import {
  createNeonClient as createSdkClient,
  raw,
  type AuthDetailsResponse,
  type ListProjectsData,
} from '@neon/sdk';
import { NEON_API_HOST } from './constants';
import pkg from '../package.json';

export type { AuthDetailsResponse };

type ListProjectsParams = NonNullable<ListProjectsData['query']>;

type ApiResponse<T> = {
  data: T;
  status: number;
  statusText: string;
};

type ConnectionUriParams = {
  projectId: string;
  branch_id?: string;
  endpoint_id?: string;
  database_name?: string;
  role_name?: string;
};

function success<T>(data: T, status = 200): ApiResponse<T> {
  return {
    data,
    status,
    statusText: 'OK',
  };
}

const USER_AGENT = `mcp-server-neon/${pkg.version}`;

/**
 * The Neon control plane attributes each request to a caller by its user agent,
 * which is what makes MCP traffic separable from direct API traffic in Segment.
 * `@neon/sdk` sends no user agent and its config exposes no way to set a header,
 * so identifying ourselves means wrapping `fetch`.
 */
export const fetchAsMcpServer: typeof fetch = (input, init) => {
  // The SDK calls this as `fetch(request)` with auth and content headers already
  // on the Request, so the header has to be added to that request rather than
  // supplied alongside it — passing an `init.headers` would replace them all.
  const request = new Request(input, init);
  request.headers.set('User-Agent', USER_AGENT);
  return fetch(request);
};

/**
 * The Neon API calls the server makes outside the tools: account resolution,
 * org selection for the project tools, and the live suites' setup and cleanup.
 * Tools call the API through `@neon/tools`.
 */
export function createNeonClient(apiKey: string) {
  const neon = createSdkClient({
    apiKey,
    baseUrl: NEON_API_HOST,
    throwOnError: true,
    fetch: fetchAsMcpServer,
  });

  return {
    async deleteProject(projectId: string) {
      const data = await neon.projects.delete({ projectId });
      return success(data);
    },

    async getProject(projectId: string) {
      const project = await neon.projects.get({ projectId });
      return success({ project });
    },

    async listProjects(params: ListProjectsParams = {}) {
      const { cursor, ...query } = params;
      const page = await neon.projects.list(query).page(cursor);
      return success({
        projects: page.items,
        pagination: { cursor: page.cursor },
      });
    },

    async listProjectBranches({
      projectId,
      cursor,
    }: {
      projectId: string;
      cursor?: string;
    }) {
      const page = await neon.branches.list({ projectId }).page(cursor);
      return success({
        branches: page.items,
        pagination: { cursor: page.cursor },
      });
    },

    async listProjectBranchDatabases(projectId: string, branchId: string) {
      const databases = await neon.postgres.databases.list({
        projectId,
        branchId,
      });
      return success({ databases });
    },

    async getConnectionUri(params: ConnectionUriParams) {
      const uri = await neon.postgres.connectionString({
        projectId: params.projectId,
        branchId: params.branch_id,
        endpointId: params.endpoint_id,
        databaseName: params.database_name,
        roleName: params.role_name,
      });
      return success({ uri });
    },

    async getCurrentUserInfo() {
      return success(await neon.user.me());
    },

    async getCurrentUserOrganizations() {
      return success({ organizations: await neon.user.organizations() });
    },

    async getAuthDetails() {
      const data = await raw.getAuthDetails({
        client: neon.client,
        throwOnError: true,
      });
      return success(data);
    },

    async getOrganization(orgId: string) {
      const data = await raw.getOrganization({
        client: neon.client,
        path: { org_id: orgId },
        throwOnError: true,
      });
      return success(data);
    },
  };
}

export type NeonApiClient = ReturnType<typeof createNeonClient>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type Api<_Unused = unknown> = NeonApiClient;
