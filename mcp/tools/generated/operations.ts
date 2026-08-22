import type { NeonToolId } from '@neon/tools';
import type { ScopeCategory } from '../../utils/grant-context';

export const GENERATED_TOOL_SCOPES = {
  'projects.list': 'projects',
  'projects.get': 'projects',
  'projects.createAndConnect': 'projects',
  'projects.update': 'projects',
  'projects.delete': 'projects',
  'projects.recover': 'projects',
  'projects.permissions.list': 'projects',
  'projects.members.list': 'projects',
  'regions.list': 'projects',
  'operations.list': 'projects',
  'operations.get': 'projects',

  'branches.list': 'branches',
  'branches.get': 'branches',
  'branches.createWithCompute': 'branches',
  'branches.update': 'branches',
  'branches.delete': 'branches',
  'branches.getDefault': 'branches',
  'branches.setDefault': 'branches',
  'branches.finalizeRestore': 'branches',
  'postgres.roles.list': 'branches',
  'postgres.roles.get': 'branches',
  'postgres.roles.create': 'branches',
  'postgres.roles.delete': 'branches',
  'postgres.roles.resetPassword': 'branches',
  'postgres.databases.list': 'branches',
  'postgres.databases.get': 'branches',
  'postgres.databases.create': 'branches',
  'postgres.databases.update': 'branches',
  'postgres.databases.delete': 'branches',

  'postgres.endpoints.list': 'endpoints',
  'postgres.endpoints.listByBranch': 'endpoints',
  'postgres.endpoints.get': 'endpoints',
  'postgres.endpoints.create': 'endpoints',
  'postgres.endpoints.update': 'endpoints',
  'postgres.endpoints.delete': 'endpoints',
  'postgres.endpoints.start': 'endpoints',
  'postgres.endpoints.suspend': 'endpoints',
  'postgres.endpoints.restart': 'endpoints',

  'snapshots.list': 'snapshots',
  'snapshots.getSchedule': 'snapshots',
  'snapshots.setSchedule': 'snapshots',
  'snapshots.create': 'snapshots',
  'snapshots.update': 'snapshots',
  'snapshots.delete': 'snapshots',
  'snapshots.restore': 'snapshots',

  'auth.get': 'neon_auth',
  'auth.create': 'neon_auth',
  'auth.disable': 'neon_auth',
  'auth.updateConfig': 'neon_auth',
  'auth.oauthProviders.list': 'neon_auth',
  'auth.oauthProviders.add': 'neon_auth',
  'auth.oauthProviders.update': 'neon_auth',
  'auth.oauthProviders.delete': 'neon_auth',
  'auth.trustedDomains.list': 'neon_auth',
  'auth.trustedDomains.add': 'neon_auth',
  'auth.trustedDomains.delete': 'neon_auth',
  'auth.users.create': 'neon_auth',
  'auth.users.delete': 'neon_auth',
  'auth.users.updateRole': 'neon_auth',

  'postgres.dataApi.get': 'data_api',
  'postgres.dataApi.create': 'data_api',
  'postgres.dataApi.update': 'data_api',
  'postgres.dataApi.delete': 'data_api',

  'logs.query': 'observability',
  'logs.fields': 'observability',
  'logs.fieldValues': 'observability',
  'aiGateway.get': 'observability',

  'functions.list': 'functions',
  'functions.get': 'functions',
  'functions.update': 'functions',
  'functions.delete': 'functions',
  'functions.deploy': 'functions',

  'storage.get': 'storage',
  'storage.buckets.list': 'storage',
  'storage.buckets.create': 'storage',
  'storage.buckets.delete': 'storage',
  'storage.objects.list': 'storage',
  'storage.objects.delete': 'storage',
  'storage.objects.deleteByPrefix': 'storage',
  'storage.objects.presign': 'storage',
} as const satisfies Partial<Record<NeonToolId, ScopeCategory>>;

export type GeneratedToolId = keyof typeof GENERATED_TOOL_SCOPES;

export const GENERATED_TOOL_IDS = Object.keys(
  GENERATED_TOOL_SCOPES,
) as GeneratedToolId[];

export const READ_ONLY_SAFE_TOOL_OVERRIDES = new Set<GeneratedToolId>([
  'logs.query',
]);

export const PROJECT_SCOPED_TOOL_OVERRIDES = {
  'projects.delete': false,
} as const satisfies Partial<Record<GeneratedToolId, boolean>>;
