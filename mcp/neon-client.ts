import {
  createNeonClient as createSdkClient,
  raw,
  type AuthDetailsResponse,
  type Branch,
  type ListProjectsData,
  type ListSharedProjectsData,
  type MemberWithUser,
  type NeonAuthAddOAuthProviderRequest,
  type NeonAuthEmailAndPasswordConfig,
  type NeonAuthEmailAndPasswordConfigUpdate,
  type NeonAuthEmailVerificationMethod as SdkNeonAuthEmailVerificationMethod,
  type NeonAuthEmailServerConfig,
  type NeonAuthIntegration,
  type NeonAuthOauthProviderId as SdkNeonAuthOauthProviderId,
  type NeonAuthOauthProvider,
  type NeonAuthOauthProviderType,
  type NeonAuthUpdateOAuthProviderRequest,
  type Organization,
  type ProjectCreateRequest,
  type ProjectListItem,
} from '@neon/sdk';
import { NEON_API_HOST } from './constants';
import pkg from '../package.json';

export type {
  AuthDetailsResponse,
  Branch,
  MemberWithUser,
  NeonAuthAddOAuthProviderRequest,
  NeonAuthEmailAndPasswordConfig,
  NeonAuthEmailAndPasswordConfigUpdate,
  NeonAuthEmailServerConfig,
  NeonAuthIntegration,
  NeonAuthOauthProvider,
  NeonAuthOauthProviderType,
  NeonAuthUpdateOAuthProviderRequest,
  Organization,
  ProjectCreateRequest,
  ProjectListItem,
};

export type NeonAuthEmailVerificationMethod =
  SdkNeonAuthEmailVerificationMethod;
export type NeonAuthOauthProviderId = SdkNeonAuthOauthProviderId;

export type ListProjectsParams = NonNullable<ListProjectsData['query']>;
export type ListSharedProjectsParams = NonNullable<
  ListSharedProjectsData['query']
>;

export type GetProjectBranchSchemaComparisonParams = {
  projectId: string;
  branchId: string;
  db_name: string;
};

type ApiResponse<T> = {
  data: T;
  status: number;
  statusText: string;
};

const endpointType = {
  ReadOnly: 'read_only',
  ReadWrite: 'read_write',
} as const;

export const EndpointType = endpointType;
export type EndpointType = (typeof endpointType)[keyof typeof endpointType];

const neonAuthSupportedAuthProvider = {
  BetterAuth: 'better_auth',
  Mock: 'mock',
  Stack: 'stack',
} as const;

export const NeonAuthSupportedAuthProvider = neonAuthSupportedAuthProvider;

const neonAuthProviderProjectOwnedBy = {
  Neon: 'neon',
  User: 'user',
} as const;

export const NeonAuthProviderProjectOwnedBy = neonAuthProviderProjectOwnedBy;

const neonAuthEmailVerificationMethod = {
  Link: 'link',
  Otp: 'otp',
} as const;

export const NeonAuthEmailVerificationMethod = neonAuthEmailVerificationMethod;

const neonAuthOauthProviderId = {
  Github: 'github',
  Google: 'google',
  Microsoft: 'microsoft',
  Vercel: 'vercel',
} as const;

export const NeonAuthOauthProviderId = neonAuthOauthProviderId;

type ProjectBranchCreateRequest = NonNullable<
  Parameters<typeof raw.createProjectBranch>[0]
>['body'];

type RestoreProjectBranchRequest = NonNullable<
  Parameters<typeof raw.restoreProjectBranch>[0]
>['body'];

type DataApiCreateRequest = NonNullable<
  Parameters<typeof raw.createProjectBranchDataApi>[0]
>['body'];

type ConnectionUriParams = {
  projectId: string;
  branch_id?: string;
  endpoint_id?: string;
  database_name?: string;
  role_name?: string;
};

type RawRequest = {
  path: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number>;
  secure?: boolean;
  validateStatus?: () => boolean;
};

function success<T>(data: T, status = 200): ApiResponse<T> {
  return {
    data,
    status,
    statusText: 'OK',
  };
}

async function readPage<T>(
  page: Promise<
    | { data: { items: T[]; cursor?: string }; error: undefined }
    | { data: undefined; error: Error }
  >,
): Promise<{ items: T[]; cursor?: string }> {
  const result = await page;
  if (result.error) throw result.error;
  return result.data;
}

/**
 * Compatibility facade used while MCP handlers are migrated. It runs every
 * documented management-API request through `@neon/sdk`: ergonomic resources
 * are preferred, while `raw` is limited to endpoints without an ergonomic
 * equivalent or where the MCP response needs the endpoint's full payload.
 */
export function createNeonClient(apiKey: string) {
  const neon = createSdkClient({
    apiKey,
    baseUrl: NEON_API_HOST,
    throwOnError: true,
  });

  return {
    async createProject(params: ProjectCreateRequest) {
      const data = await raw.createProject({
        client: neon.client,
        body: params,
        throwOnError: true,
      });
      return success(data, 201);
    },

    async deleteProject(projectId: string) {
      const data = await neon.projects.delete(projectId);
      return success(data);
    },

    async getProject(projectId: string) {
      const project = await neon.projects.get(projectId);
      return success({ project });
    },

    async listProjects(params: ListProjectsParams = {}) {
      const { cursor, ...query } = params;
      const page = await readPage(neon.projects.list(query).page(cursor));
      return success({
        projects: page.items,
        pagination: { cursor: page.cursor },
      });
    },

    async createProjectBranch(
      projectId: string,
      request: ProjectBranchCreateRequest,
    ) {
      const data = await raw.createProjectBranch({
        client: neon.client,
        path: { project_id: projectId },
        body: request,
        throwOnError: true,
      });
      return success(data, 201);
    },

    async deleteProjectBranch(projectId: string, branchId: string) {
      await neon.branches.delete(projectId, branchId);
      return success(undefined);
    },

    async getProjectBranch(projectId: string, branchId: string) {
      const branch = await neon.branches.get(projectId, branchId);
      return success({ branch });
    },

    async listProjectBranches({
      projectId,
      cursor,
    }: {
      projectId: string;
      cursor?: string;
    }) {
      const page = await readPage(neon.branches.list(projectId).page(cursor));
      return success({
        branches: page.items,
        pagination: { cursor: page.cursor },
      });
    },

    async restoreProjectBranch(
      projectId: string,
      branchId: string,
      request: RestoreProjectBranchRequest,
    ) {
      const data = await raw.restoreProjectBranch({
        client: neon.client,
        path: { project_id: projectId, branch_id: branchId },
        body: request,
        throwOnError: true,
      });
      return success(data);
    },

    async listProjectEndpoints(projectId: string) {
      const endpoints = await neon.postgres.endpoints.list(projectId);
      return success({ endpoints });
    },

    async listProjectBranchEndpoints(projectId: string, branchId: string) {
      const endpoints = await neon.postgres.endpoints.listByBranch(
        projectId,
        branchId,
      );
      return success({ endpoints });
    },

    async listProjectBranchDatabases(projectId: string, branchId: string) {
      const databases = await neon.postgres.databases.list(projectId, branchId);
      return success({ databases });
    },

    async getProjectBranchDatabase(
      projectId: string,
      branchId: string,
      databaseName: string,
    ) {
      const database = await neon.postgres.databases.get(
        projectId,
        branchId,
        databaseName,
      );
      return success({ database });
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

    async getOrganizationMembers(orgId: string) {
      const data = await raw.getOrganizationMembers({
        client: neon.client,
        path: { org_id: orgId },
        throwOnError: true,
      });
      return success(data);
    },

    async listSharedProjects(params: ListSharedProjectsParams = {}) {
      const data = await raw.listSharedProjects({
        client: neon.client,
        query: params,
        throwOnError: true,
      });
      return success(data);
    },

    async getProjectBranchSchemaComparison(
      params: GetProjectBranchSchemaComparisonParams,
    ) {
      const data = await raw.getProjectBranchSchemaComparison({
        client: neon.client,
        path: {
          project_id: params.projectId,
          branch_id: params.branchId,
        },
        query: { db_name: params.db_name },
        throwOnError: true,
      });
      return success(data);
    },

    async getNeonAuth(projectId: string, branchId: string) {
      return success(await neon.auth.get(projectId, branchId));
    },

    async createNeonAuth(
      projectId: string,
      branchId: string,
      request: Parameters<typeof neon.auth.create>[2],
    ) {
      return success(await neon.auth.create(projectId, branchId, request), 201);
    },

    async listBranchNeonAuthTrustedDomains(
      projectId: string,
      branchId: string,
    ) {
      return success({
        domains: await neon.auth.trustedDomains.list(projectId, branchId),
      });
    },

    async addBranchNeonAuthTrustedDomain(
      projectId: string,
      branchId: string,
      request: {
        domain: string;
        auth_provider: 'better_auth';
      },
    ) {
      await neon.auth.trustedDomains.add(projectId, branchId, request);
      return success(undefined, 201);
    },

    async deleteBranchNeonAuthTrustedDomain(
      projectId: string,
      branchId: string,
      request: {
        auth_provider: 'better_auth';
        domains: { domain: string }[];
      },
    ) {
      await neon.auth.trustedDomains.delete(projectId, branchId, request);
      return success(undefined);
    },

    async listBranchNeonAuthOauthProviders(
      projectId: string,
      branchId: string,
    ) {
      return success({
        providers: await neon.auth.oauthProviders.list(projectId, branchId),
      });
    },

    async addBranchNeonAuthOauthProvider(
      projectId: string,
      branchId: string,
      request: NeonAuthAddOAuthProviderRequest,
    ) {
      return success(
        await neon.auth.oauthProviders.add(projectId, branchId, request),
        201,
      );
    },

    async updateBranchNeonAuthOauthProvider(
      projectId: string,
      branchId: string,
      providerId: NeonAuthOauthProviderId,
      request: NeonAuthUpdateOAuthProviderRequest,
    ) {
      return success(
        await neon.auth.oauthProviders.update(
          projectId,
          branchId,
          providerId,
          request,
        ),
      );
    },

    async deleteBranchNeonAuthOauthProvider(
      projectId: string,
      branchId: string,
      providerId: NeonAuthOauthProviderId,
    ) {
      await neon.auth.oauthProviders.delete(projectId, branchId, providerId);
      return success(undefined);
    },

    async getNeonAuthAllowLocalhost(projectId: string, branchId: string) {
      const data = await raw.getNeonAuthAllowLocalhost({
        client: neon.client,
        path: { project_id: projectId, branch_id: branchId },
        throwOnError: true,
      });
      return success(data);
    },

    async updateNeonAuthAllowLocalhost(
      projectId: string,
      branchId: string,
      request: { allow_localhost: boolean },
    ) {
      const data = await raw.updateNeonAuthAllowLocalhost({
        client: neon.client,
        path: { project_id: projectId, branch_id: branchId },
        body: request,
        throwOnError: true,
      });
      return success(data);
    },

    async getNeonAuthEmailAndPasswordConfig(
      projectId: string,
      branchId: string,
    ) {
      const data = await raw.getNeonAuthEmailAndPasswordConfig({
        client: neon.client,
        path: { project_id: projectId, branch_id: branchId },
        throwOnError: true,
      });
      return success(data);
    },

    async updateNeonAuthEmailAndPasswordConfig(
      projectId: string,
      branchId: string,
      request: NeonAuthEmailAndPasswordConfigUpdate,
    ) {
      const data = await raw.updateNeonAuthEmailAndPasswordConfig({
        client: neon.client,
        path: { project_id: projectId, branch_id: branchId },
        body: request,
        throwOnError: true,
      });
      return success(data);
    },

    async getNeonAuthEmailProvider(projectId: string, branchId: string) {
      const data = await raw.getNeonAuthEmailProvider({
        client: neon.client,
        path: { project_id: projectId, branch_id: branchId },
        throwOnError: true,
      });
      return success(data);
    },

    async updateNeonAuthEmailProvider(
      projectId: string,
      branchId: string,
      request: NeonAuthEmailServerConfig,
    ) {
      const data = await raw.updateNeonAuthEmailProvider({
        client: neon.client,
        path: { project_id: projectId, branch_id: branchId },
        body: request,
        throwOnError: true,
      });
      return success(data);
    },

    async sendNeonAuthTestEmail(
      projectId: string,
      branchId: string,
      request: {
        recipient_email: string;
        host: string;
        port: number;
        username: string;
        password: string;
        sender_email: string;
        sender_name: string;
      },
    ) {
      const data = await raw.sendNeonAuthTestEmail({
        client: neon.client,
        path: { project_id: projectId, branch_id: branchId },
        body: request,
        throwOnError: true,
      });
      return success(data);
    },

    async getProjectBranchDataApi(
      projectId: string,
      branchId: string,
      databaseName: string,
    ) {
      return success(
        await neon.postgres.dataApi.get(projectId, branchId, databaseName),
      );
    },

    async createProjectBranchDataApi(
      projectId: string,
      branchId: string,
      databaseName: string,
      request: DataApiCreateRequest,
    ) {
      return success(
        await neon.postgres.dataApi.create(
          projectId,
          branchId,
          databaseName,
          request,
        ),
        201,
      );
    },

    async request<T>(request: RawRequest): Promise<ApiResponse<T>> {
      const url = new URL(request.path);
      for (const [key, value] of Object.entries(request.query ?? {})) {
        url.searchParams.set(key, String(value));
      }
      const response = await fetch(url, {
        method: request.method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'User-Agent': `mcp-server-neon/${pkg.version}`,
        },
      });
      const data: T = await response.json();
      return {
        data,
        status: response.status,
        statusText: response.statusText,
      };
    },

    get apiKey() {
      return apiKey;
    },

    get userAgent() {
      return `mcp-server-neon/${pkg.version}`;
    },
  };
}

export type NeonApiClient = ReturnType<typeof createNeonClient>;
// Compatibility with handlers that previously used `Api<unknown>`.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type Api<_Unused = unknown> = NeonApiClient;
