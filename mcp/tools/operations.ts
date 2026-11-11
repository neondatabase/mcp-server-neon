import type { NeonToolId } from '@neon/tools';
import type { ScopeCategory } from '../utils/grant-context';

type CustomToolGrant = {
  scope: ScopeCategory | null;
  readOnlySafe: boolean;
  projectScoped: boolean;
};

/**
 * The tools this server used to implement itself. Their grant flags are stated
 * per tool: SQL tools report `metadata.method: "SQL"` whether or not the caller's
 * SQL can write, and the docs, feedback, and incidents tools have no project in
 * their path but stay visible on project-scoped connections.
 *
 * `readOnlySafe` on a tool that runs caller SQL means it runs exactly one
 * statement in its own `READ ONLY` transaction, as `sql.run` does.
 * `sql.runTransaction` is not: a `COMMIT` or `SET TRANSACTION READ WRITE`
 * statement can leave the read-only transaction. `postgres.connectionString`
 * mutates nothing, but its URI carries a privileged role password that works
 * against the read-write compute.
 */
export const CUSTOM_TOOL_GRANTS = {
  'user.organizations': {
    scope: 'projects',
    readOnlySafe: true,
    projectScoped: false,
  },
  'sql.run': { scope: 'querying', readOnlySafe: true, projectScoped: true },
  'sql.runTransaction': {
    scope: 'querying',
    readOnlySafe: false,
    projectScoped: true,
  },
  'schema.describeTable': {
    scope: 'schema',
    readOnlySafe: true,
    projectScoped: true,
  },
  'schema.listTables': {
    scope: 'schema',
    readOnlySafe: true,
    projectScoped: true,
  },
  'migrations.prepare': {
    scope: 'querying',
    readOnlySafe: false,
    projectScoped: true,
  },
  'migrations.complete': {
    scope: 'querying',
    readOnlySafe: false,
    projectScoped: true,
  },
  'branches.describe': {
    scope: 'branches',
    readOnlySafe: true,
    projectScoped: true,
  },
  'postgres.connectionString': {
    scope: 'branches',
    readOnlySafe: false,
    projectScoped: true,
  },
  'auth.getConfig': {
    scope: 'neon_auth',
    readOnlySafe: true,
    projectScoped: true,
  },
  'sql.explain': { scope: 'querying', readOnlySafe: true, projectScoped: true },
  'queryTuning.prepare': {
    scope: 'querying',
    readOnlySafe: false,
    projectScoped: true,
  },
  'queryTuning.complete': {
    scope: 'querying',
    readOnlySafe: false,
    projectScoped: true,
  },
  'queries.listSlow': {
    scope: 'querying',
    readOnlySafe: true,
    projectScoped: true,
  },
  'database.inspect': {
    scope: 'querying',
    readOnlySafe: true,
    projectScoped: true,
  },
  'resources.search': { scope: null, readOnlySafe: true, projectScoped: false },
  'resources.fetch': { scope: null, readOnlySafe: true, projectScoped: false },
  'docs.search': { scope: 'docs', readOnlySafe: true, projectScoped: true },
  'docs.get': { scope: 'docs', readOnlySafe: true, projectScoped: true },
  // Changes no Neon resource, so it stays available in read-only mode.
  'feedback.send': { scope: null, readOnlySafe: true, projectScoped: true },
  'incidents.list': { scope: null, readOnlySafe: true, projectScoped: true },
} as const satisfies Partial<Record<NeonToolId, CustomToolGrant>>;

export type CustomToolId = keyof typeof CUSTOM_TOOL_GRANTS;

export const GENERATED_TOOL_SCOPES = {
  'projects.list': 'projects',
  'projects.count': 'projects',
  'projects.get': 'projects',
  'projects.create': 'projects',
  'projects.update': 'projects',
  'projects.delete': 'projects',
  'projects.recover': 'projects',
  'projects.permissions.list': 'projects',
  'projects.members.list': 'projects',
  'regions.list': 'projects',
  'operations.list': 'projects',
  'operations.get': 'projects',
  'consumption.perProjectV2': 'projects',
  'consumption.perBranchV2': 'projects',

  'branches.list': 'branches',
  'branches.get': 'branches',
  'branches.create': 'branches',
  'branches.update': 'branches',
  'branches.delete': 'branches',
  'branches.getDefault': 'branches',
  'branches.setDefault': 'branches',
  'branches.resetFromParent': 'branches',
  'branches.compareSchema': 'schema',
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
  'auth.oauthServer.get': 'neon_auth',
  'auth.oauthServer.update': 'neon_auth',
  'auth.oauthClients.list': 'neon_auth',
  'auth.oauthClients.get': 'neon_auth',
  'auth.oauthClients.create': 'neon_auth',
  'auth.oauthClients.update': 'neon_auth',
  'auth.oauthClients.delete': 'neon_auth',
  'auth.oauthClients.rotateSecret': 'neon_auth',
  'auth.allowLocalhost.update': 'neon_auth',
  'auth.emailAndPassword.update': 'neon_auth',
  'auth.emailProvider.update': 'neon_auth',
  'auth.emailProvider.sendTest': 'neon_auth',
  'auth.plugins.magicLink.update': 'neon_auth',
  'auth.plugins.organization.update': 'neon_auth',
  'auth.plugins.phoneNumber.update': 'neon_auth',
  'auth.webhooks.update': 'neon_auth',
  'auth.logsExport.update': 'neon_auth',

  'postgres.dataApi.get': 'data_api',
  'postgres.dataApi.create': 'data_api',
  'postgres.dataApi.update': 'data_api',
  'postgres.dataApi.delete': 'data_api',

  'logs.query': 'observability',
  'logs.fields': 'observability',
  'logs.fieldValues': 'observability',
  'logs.loki.queryRange': 'observability',
  'aiGateway.get': 'observability',

  'functions.list': 'functions',
  'functions.get': 'functions',
  'functions.update': 'functions',
  'functions.delete': 'functions',
  'functions.deploy': 'functions',
  'functions.customDomains.list': 'functions',
  'functions.customDomains.register': 'functions',
  'functions.customDomains.delete': 'functions',

  'triggers.list': 'functions',
  'triggers.get': 'functions',
  'triggers.create': 'functions',
  'triggers.update': 'functions',
  'triggers.delete': 'functions',

  'credentials.list': 'branches',
  'credentials.create': 'branches',
  'credentials.revoke': 'branches',
  'credentials.rotate': 'branches',

  'storage.get': 'storage',
  'storage.buckets.list': 'storage',
  'storage.buckets.create': 'storage',
  'storage.buckets.delete': 'storage',
  'storage.objects.list': 'storage',
  'storage.objects.delete': 'storage',
  'storage.objects.deleteByPrefix': 'storage',
  'storage.objects.presign': 'storage',

  'realtime.get': 'realtime',
  'realtime.enable': 'realtime',
  'realtime.disable': 'realtime',
  'realtime.secret': 'realtime',
  'realtime.rotateSecret': 'realtime',
} as const satisfies Partial<Record<NeonToolId, ScopeCategory>>;

export type GeneratedToolId = keyof typeof GENERATED_TOOL_SCOPES;

export type ToolId = CustomToolId | GeneratedToolId;

function isKeyOf<T extends object>(
  record: T,
  key: string,
): key is Extract<keyof T, string> {
  return Object.hasOwn(record, key);
}

export function isCustomToolId(id: string): id is CustomToolId {
  return isKeyOf(CUSTOM_TOOL_GRANTS, id);
}

export function isGeneratedToolId(id: string): id is GeneratedToolId {
  return isKeyOf(GENERATED_TOOL_SCOPES, id);
}

export function isToolId(id: string): id is ToolId {
  return isCustomToolId(id) || isGeneratedToolId(id);
}

export const TOOL_IDS: ToolId[] = [
  ...Object.keys(CUSTOM_TOOL_GRANTS).filter(isCustomToolId),
  ...Object.keys(GENERATED_TOOL_SCOPES).filter(isGeneratedToolId),
];

export const READ_ONLY_SAFE_TOOL_OVERRIDES = new Set<GeneratedToolId>([
  'logs.query',
]);

export const PROJECT_SCOPED_TOOL_OVERRIDES = {
  'projects.delete': false,
} as const satisfies Partial<Record<GeneratedToolId, boolean>>;
