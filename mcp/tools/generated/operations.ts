import type { NeonOperationId } from '@neon/tools';
import type { ScopeCategory } from '../../utils/grant-context';

/**
 * Management API operations this server exposes, keyed by OpenAPI operation id
 * and assigned to a `?category=` scope.
 *
 * Left out on purpose: API keys, AI Gateway credentials, billing, org
 * membership writes and invitations, transfers, Auth (legacy), consumption,
 * org VPC, getAuthDetails, and secret-returning GETs (connection URI, role
 * password, Auth OAuth listings, email provider, plugin configs).
 */
export const GENERATED_OPERATION_SCOPES = {
  listProjects: 'projects',
  listSharedProjects: 'projects',
  createProject: 'projects',
  deleteProject: 'projects',
  getProject: 'projects',
  updateProject: 'projects',
  recoverProject: 'projects',
  getActiveRegions: 'projects',
  listProjectOperations: 'projects',
  getProjectOperation: 'projects',
  getOrganization: 'projects',
  getOrganizationMembers: 'projects',
  getOrganizationMember: 'projects',
  listProjectMembers: 'projects',
  listProjectPermissions: 'projects',
  grantPermissionToProject: 'projects',
  revokePermissionFromProject: 'projects',
  setProjectMemberRole: 'projects',
  removeProjectMemberRole: 'projects',
  listProjectVPCEndpoints: 'projects',
  assignProjectVPCEndpoint: 'projects',
  deleteProjectVPCEndpoint: 'projects',
  getAvailablePreloadLibraries: 'projects',

  listProjectBranches: 'branches',
  countProjectBranches: 'branches',
  getProjectBranch: 'branches',
  updateProjectBranch: 'branches',
  createProjectBranch: 'branches',
  deleteProjectBranch: 'branches',
  setDefaultProjectBranch: 'branches',
  restoreProjectBranch: 'branches',
  finalizeRestoreBranch: 'branches',
  createProjectBranchAnonymized: 'branches',
  startAnonymization: 'branches',
  getAnonymizedBranchStatus: 'branches',
  getMaskingRules: 'branches',
  updateMaskingRules: 'branches',
  listProjectBranchDatabases: 'branches',
  getProjectBranchDatabase: 'branches',
  createProjectBranchDatabase: 'branches',
  updateProjectBranchDatabase: 'branches',
  deleteProjectBranchDatabase: 'branches',
  listProjectBranchRoles: 'branches',
  getProjectBranchRole: 'branches',
  createProjectBranchRole: 'branches',
  deleteProjectBranchRole: 'branches',
  resetProjectBranchRolePassword: 'branches',
  listProjectEndpoints: 'branches',
  listProjectBranchEndpoints: 'branches',
  getProjectEndpoint: 'branches',
  createProjectEndpoint: 'branches',
  updateProjectEndpoint: 'branches',
  deleteProjectEndpoint: 'branches',
  startProjectEndpoint: 'branches',
  suspendProjectEndpoint: 'branches',
  restartProjectEndpoint: 'branches',
  listSnapshots: 'branches',
  getSnapshotSchedule: 'branches',
  setSnapshotSchedule: 'branches',
  createSnapshot: 'branches',
  updateSnapshot: 'branches',
  deleteSnapshot: 'branches',
  restoreSnapshot: 'branches',

  getProjectBranchSchema: 'schema',
  getProjectBranchSchemaComparison: 'schema',

  createNeonAuth: 'neon_auth',
  getNeonAuth: 'neon_auth',
  disableNeonAuth: 'neon_auth',
  addBranchNeonAuthOauthProvider: 'neon_auth',
  updateBranchNeonAuthOauthProvider: 'neon_auth',
  deleteBranchNeonAuthOauthProvider: 'neon_auth',
  addBranchNeonAuthTrustedDomain: 'neon_auth',
  listBranchNeonAuthTrustedDomains: 'neon_auth',
  deleteBranchNeonAuthTrustedDomain: 'neon_auth',
  createBranchNeonAuthNewUser: 'neon_auth',
  deleteBranchNeonAuthUser: 'neon_auth',
  updateNeonAuthUserRole: 'neon_auth',
  getNeonAuthAllowLocalhost: 'neon_auth',
  updateNeonAuthAllowLocalhost: 'neon_auth',
  getNeonAuthEmailAndPasswordConfig: 'neon_auth',
  updateNeonAuthEmailAndPasswordConfig: 'neon_auth',
  updateNeonAuthEmailProvider: 'neon_auth',
  getNeonAuthPhoneNumberPlugin: 'neon_auth',
  updateNeonAuthPhoneNumberPlugin: 'neon_auth',
  updateNeonAuthMagicLinkPlugin: 'neon_auth',
  updateNeonAuthOrganizationPlugin: 'neon_auth',
  getNeonAuthWebhookConfig: 'neon_auth',
  updateNeonAuthWebhookConfig: 'neon_auth',
  updateNeonAuthConfig: 'neon_auth',
  sendNeonAuthTestEmail: 'neon_auth',

  createProjectBranchDataAPI: 'data_api',
  getProjectBranchDataAPI: 'data_api',
  updateProjectBranchDataAPI: 'data_api',
  deleteProjectBranchDataAPI: 'data_api',
  addProjectJWKS: 'data_api',
  getProjectJWKS: 'data_api',
  deleteProjectJWKS: 'data_api',

  queryProjectBranchLogs: 'observability',
  listProjectBranchLogFields: 'observability',
  listProjectBranchLogFieldValues: 'observability',
  getProjectAdvisorSecurityIssues: 'observability',
  getProjectBranchAiGateway: 'observability',

  listProjectBranchFunctions: 'functions',
  getProjectBranchFunction: 'functions',
  updateProjectBranchFunction: 'functions',
  deleteProjectBranchFunction: 'functions',
  createProjectBranchFunctionDeployment: 'functions',

  listProjectBranchBuckets: 'storage',
  createProjectBranchBucket: 'storage',
  deleteProjectBranchBucket: 'storage',
  listProjectBranchBucketObjects: 'storage',
  getProjectBranchBucketObject: 'storage',
  deleteProjectBranchBucketObject: 'storage',
  deleteProjectBranchBucketObjectsByPrefix: 'storage',
  presignProjectBranchBucketObject: 'storage',
  getProjectBranchStorage: 'storage',
} as const satisfies Partial<Record<NeonOperationId, ScopeCategory>>;

export type GeneratedOperationId = keyof typeof GENERATED_OPERATION_SCOPES;

export const GENERATED_OPERATION_IDS = Object.keys(
  GENERATED_OPERATION_SCOPES,
) as GeneratedOperationId[];

export const READ_ONLY_SAFE_OPERATION_OVERRIDES = new Set<GeneratedOperationId>(
  ['queryProjectBranchLogs'],
);

export const PROJECT_SCOPED_OPERATION_OVERRIDES = {
  deleteProject: false,
} as const satisfies Partial<Record<GeneratedOperationId, boolean>>;
