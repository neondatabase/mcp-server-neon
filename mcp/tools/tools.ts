import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { NeonClientError, NeonNetworkError } from '@neon/sdk';
import type { NeonEffectToolContext } from '@neon/tools/effect';
import {
  retryReadOnlyNetworkFailures,
  toEffectTools,
} from '@neon/tools/effect';
import { Cause, Effect, Option, Schedule } from 'effect';
import * as z from 'zod';
import { InvalidArgumentError, NotFoundError } from '../server/errors';
import {
  GET_CONNECTION_STRING_INPUT_SCHEMA,
  NEON_TOOLS,
  PACKAGE_TOOLS,
} from './definitions';
import { ToolStepFailed } from './errors';
import type { ToolId } from './operations';
import { assertOutputContract } from './output-contract';
import type { NeonTool } from './tool-definition';
import type {
  ToolCallError,
  ToolHandler,
  ToolHandlerExtraParams,
  ToolHandlers,
} from './types';
import { getOrgByOrgIdOrDefault } from './utils';

const TOOLS_REQUIRING_ORG_ID = new Set<ToolId>([
  'projects.list',
  'projects.count',
  'projects.create',
]);

// A read that got no response from the Neon API is sent again; mutations never are.
const EFFECT_TOOLS = toEffectTools(PACKAGE_TOOLS, {
  retry: retryReadOnlyNetworkFailures,
});

function executionContext(
  extra: ToolHandlerExtraParams | undefined,
): NeonEffectToolContext {
  return {
    apiKey: extra?.apiKey,
    readOnly: extra?.readOnly,
    secrets: extra?.secrets,
    postgresRole: extra?.pinnedRoleName,
    caller: {
      source: 'mcp',
      userAgent: extra?.userAgent,
      client: extra?.clientApplication,
    },
  };
}

/**
 * A scoped `create_postgres_role` runs its SQL as the database owner, and a pinned
 * connection promises that every SQL the server runs logs in as the pinned role.
 */
function assertRoleCreateAllowed(
  parsed: unknown,
  pinnedRoleName: string | undefined,
): void {
  if (pinnedRoleName === undefined) return;
  if (typeof parsed !== 'object' || parsed === null || !('access' in parsed)) {
    return;
  }
  if (parsed.access === 'read_only' || parsed.access === 'read_write') {
    throw new InvalidArgumentError(
      `This connection is pinned to Postgres role "${pinnedRoleName}", so its SQL runs only as that role. access ${parsed.access} creates the role with SQL as the database owner, which this connection does not allow. Connect without roleName to create a ${parsed.access} role.`,
    );
  }
}

type OrgLookupContext = {
  neonClient: Parameters<ToolHandler>[1];
  extra: ToolHandlerExtraParams | undefined;
  signal: AbortSignal;
};

async function withOrgId(
  parsed: unknown,
  { neonClient, extra, signal }: OrgLookupContext,
): Promise<object> {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Tool input must be an object');
  }
  if (!neonClient || !extra?.account) {
    throw new Error('Resolving org_id requires an authenticated Neon client');
  }
  let orgId: string | undefined;
  if ('org_id' in parsed && parsed.org_id !== undefined) {
    if (typeof parsed.org_id !== 'string') {
      throw new Error('org_id must be a string');
    }
    orgId = parsed.org_id;
  }
  const organization = await getOrgByOrgIdOrDefault(
    { org_id: orgId, signal },
    neonClient,
    extra.account,
  );
  return { ...parsed, org_id: organization.id };
}

function packageInput(tool: NeonTool, params: Record<string, unknown>) {
  if (tool.id === 'postgres.connectionString') {
    const { compute_id, ...target } =
      GET_CONNECTION_STRING_INPUT_SCHEMA.parse(params);
    return { ...target, endpoint_id: compute_id };
  }
  return tool.inputSchema.parse(params);
}

const PACKAGE_DOC_NOT_FOUND =
  /^Doc page not found: "(.+)"\. Pass the slug of a docs search hit\.$/;

// The package's message cannot name search_docs, which is the MCP name.
function docNotFoundError(error: unknown): unknown {
  if (!(error instanceof NeonClientError)) return error;
  const slug = PACKAGE_DOC_NOT_FOUND.exec(error.message)?.[1];
  if (slug === undefined) return error;
  return new NotFoundError(
    `Doc page not found: "${slug}". Pass a slug returned by search_docs.`,
  );
}

function jsonText(data: unknown) {
  return { type: 'text' as const, text: JSON.stringify(data, null, 2) };
}

const statementSchema = z.object({
  rows: z.array(z.unknown()),
  totalRowCount: z.number(),
  truncated: z.boolean(),
  note: z.string().optional(),
});

type Statement = z.infer<typeof statementSchema>;

function statementSummary({ totalRowCount, truncated, note }: Statement) {
  return note === undefined
    ? { totalRowCount, truncated }
    : { totalRowCount, truncated, note };
}

// A result that fits keeps the bare rows clients already parse; the summary
// block appears only when a statement was cut at `max_rows`.
function sqlRunResult(data: unknown): CallToolResult {
  const statement = statementSchema.parse(data);
  return {
    content: statement.truncated
      ? [jsonText(statement.rows), jsonText(statementSummary(statement))]
      : [jsonText(statement.rows)],
  };
}

function sqlTransactionResult(data: unknown): CallToolResult {
  const statements = z.array(statementSchema).parse(data);
  const rows = statements.map((statement) => statement.rows);
  return {
    content: statements.some((statement) => statement.truncated)
      ? [jsonText(rows), jsonText(statements.map(statementSummary))]
      : [jsonText(rows)],
  };
}

// The OpenAI search and fetch connector contract reads `structuredContent`.
function structuredResult(data: unknown): CallToolResult {
  const structuredContent = z.record(z.string(), z.unknown()).parse(data);
  return { content: [jsonText(structuredContent)], structuredContent };
}

const preparedMigrationSchema = z.object({
  complete: z.object({
    migration_id: z.string(),
    migration_sql: z.string(),
    database_name: z.string(),
    project_id: z.string(),
    temporary_branch_id: z.string(),
    parent_branch_id: z.string(),
  }),
  temporary_branch: z.object({
    id: z.string(),
    name: z.string(),
    parent_id: z.string(),
  }),
  migration_result: z.unknown(),
});

function preparedMigrationResult(data: unknown): CallToolResult {
  const { complete, temporary_branch, migration_result } =
    preparedMigrationSchema.parse(data);
  return {
    content: [
      {
        type: 'text',
        text: `
<status>Migration created successfully in temporary branch</status>

<migration_context>
You MUST pass ALL these values to complete_database_migration:
- migration_id: ${complete.migration_id}
- migration_sql: ${complete.migration_sql}
- database_name: ${complete.database_name}
- project_id: ${complete.project_id}
- temporary_branch_id: ${complete.temporary_branch_id}
- parent_branch_id: ${complete.parent_branch_id}
</migration_context>

<temporary_branch>
- Name: ${temporary_branch.name}
- ID: ${temporary_branch.id}
- Parent Branch ID: ${temporary_branch.parent_id}
</temporary_branch>

<execution_result>${JSON.stringify(migration_result, null, 2)}</execution_result>

<next_actions>
You MUST follow these steps:
1. Test this migration using \`run_sql\` tool on branch \`${temporary_branch.name}\` (branch ID: ${temporary_branch.id})
2. Verify the changes meet your requirements
3. If satisfied, use \`complete_database_migration\` with ALL the values from migration_context above
4. If not satisfied, use \`complete_database_migration\` with apply_changes: false to cancel and cleanup
</next_actions>
            `,
      },
    ],
  };
}

const preparedTuningSchema = z.object({
  complete: z.object({
    tuning_id: z.string(),
    database_name: z.string(),
    project_id: z.string(),
    temporary_branch_id: z.string(),
    role_name: z.string().optional(),
  }),
  execution_plan: z.unknown(),
  table_schemas: z.unknown(),
  sql: z.string(),
});

function preparedTuningResult(data: unknown): CallToolResult {
  const { complete, execution_plan, table_schemas, sql } =
    preparedTuningSchema.parse(data);
  return {
    content: [jsonText({ ...complete, execution_plan, table_schemas, sql })],
  };
}

function connectionStringResult(
  data: unknown,
  params: Record<string, unknown>,
): CallToolResult {
  const uri = z.string().parse(data);
  const input = GET_CONNECTION_STRING_INPUT_SCHEMA.parse(params);
  // The URI names the database and role the package resolved.
  const url = new URL(uri);
  const text = [
    'Connection string details:',
    `URI: ${uri}`,
    `Project ID: ${input.project_id}`,
    `Database: ${decodeURIComponent(url.pathname.slice(1))}`,
    `Role: ${decodeURIComponent(url.username)}`,
    input.branch_id ? `Branch ID: ${input.branch_id}` : 'Using default branch',
    input.compute_id
      ? `Compute ID: ${input.compute_id}`
      : 'Using default compute',
    '',
    'You can use this connection string with any PostgreSQL client to connect to your Neon database.',
  ].join('\n');
  return { content: [{ type: 'text', text }] };
}

function docResult(data: unknown): CallToolResult {
  const { markdown } = z.object({ markdown: z.string() }).parse(data);
  return { content: [{ type: 'text', text: markdown }] };
}

function feedbackResult(data: unknown): CallToolResult {
  const { message } = z.object({ message: z.string() }).parse(data);
  return { content: [{ type: 'text', text: message }] };
}

const completedMigrationSchema = z.object({
  applied: z.boolean(),
  deletedBranchId: z.string().optional(),
  cleanupError: z.string().optional(),
  migrationResult: z.unknown().optional(),
});

function completedMigrationResult(data: unknown): CallToolResult {
  const { applied, deletedBranchId, cleanupError, migrationResult } =
    completedMigrationSchema.parse(data);
  const result = JSON.stringify(migrationResult, null, 2);
  const cleanupWarning = `⚠️ Warning: Failed to delete temporary branch. Manual cleanup may be required. Error: ${cleanupError}`;
  let text: string;
  if (applied) {
    text = deletedBranchId
      ? `Migration applied successfully to parent branch. Temporary branch ${deletedBranchId} deleted.\n\nResult: ${result}`
      : `Migration applied successfully to parent branch.\n\n${cleanupWarning}\n\nResult: ${result}`;
  } else {
    text = deletedBranchId
      ? `Migration cancelled. Temporary branch ${deletedBranchId} deleted without applying changes.`
      : `Migration cancelled.\n\n${cleanupWarning}`;
  }
  return { content: [{ type: 'text', text }] };
}

const RESULT_RENDERERS: Partial<
  Record<
    ToolId,
    (data: unknown, params: Record<string, unknown>) => CallToolResult
  >
> = {
  'sql.run': sqlRunResult,
  'sql.runTransaction': sqlTransactionResult,
  'resources.search': structuredResult,
  'resources.fetch': structuredResult,
  'migrations.prepare': preparedMigrationResult,
  'queryTuning.prepare': preparedTuningResult,
  'migrations.complete': completedMigrationResult,
  'postgres.connectionString': connectionStringResult,
  'docs.get': docResult,
  'feedback.send': feedbackResult,
};

function toolResult(
  toolId: ToolId,
  data: unknown,
  params: Record<string, unknown>,
): CallToolResult {
  const render = RESULT_RENDERERS[toolId];
  if (render) {
    const rendered = render(data, params);

    return rendered.structuredContent === undefined
      ? { ...rendered, structuredContent: { data } }
      : rendered;
  }
  return { content: [jsonText(data)], structuredContent: { data } };
}

// A non-Error throw is rethrown, so Effect records it as a defect.
const catchStep: (error: unknown) => ToolStepFailed = (error) => {
  if (error instanceof Error) {
    return ToolStepFailed.make({ error });
  }

  throw error;
};

/** Runs one of the server's own steps around a package tool. */
export const step = <A>(run: () => A) =>
  Effect.try({ try: run, catch: catchStep });

// The org lookup is a read, retried like the package tools' reads before the
// tool itself runs.
const orgLookup = <A>(run: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: catchStep }).pipe(
    Effect.retry({
      schedule: Schedule.exponential('200 millis').pipe(Schedule.jittered),
      times: 2,
      while: ({ error }) => error instanceof NeonNetworkError,
    }),
  );

/** The error a tool call failed with, as the package or a step threw it. */
export const thrownError = (error: ToolCallError): Error =>
  error instanceof ToolStepFailed ? error.error : error.cause;

const docNotFound = (error: ToolCallError): ToolCallError => {
  const thrown = thrownError(error);
  const mapped = docNotFoundError(thrown);

  return mapped instanceof Error && mapped !== thrown
    ? ToolStepFailed.make({ error: mapped })
    : error;
};

// A failed completion can leave the temporary branch behind, so it is reported
// as a server error that reaches Sentry rather than as caller input.
const queryTuningCompletionFailed = (cause: Cause.Cause<ToolCallError>) => {
  if (Cause.hasInterruptsOnly(cause)) {
    return Effect.failCause(cause);
  }

  const failed = Option.match(Cause.findErrorOption(cause), {
    onNone: () => Cause.squash(cause),
    onSome: thrownError,
  });

  return Effect.fail(
    ToolStepFailed.make({
      error: new Error(
        `Failed to complete query tuning: ${failed instanceof Error ? failed.message : String(failed)}`,
      ),
    }),
  );
};

const PACKAGE_FAILURES: Partial<
  Record<
    ToolId,
    <A>(
      execution: Effect.Effect<A, ToolCallError>,
    ) => Effect.Effect<A, ToolCallError>
  >
> = {
  'docs.get': Effect.mapError(docNotFound),
  'queryTuning.complete': Effect.catchCause(queryTuningCompletionFailed),
};

function toolHandler(tool: NeonTool): ToolHandler {
  const effectTool = EFFECT_TOOLS[tool.id];
  const mapFailures = PACKAGE_FAILURES[tool.id];

  return (args, neonClient, extra) =>
    Effect.gen(function* () {
      const params = args?.params ?? {};
      const parsed = yield* step(() => packageInput(tool, params));

      if (tool.id === 'postgres.roles.create') {
        yield* step(() => {
          assertRoleCreateAllowed(parsed, extra?.pinnedRoleName);
        });
      }

      const input = TOOLS_REQUIRING_ORG_ID.has(tool.id)
        ? yield* orgLookup(async (signal) =>
            withOrgId(parsed, { neonClient, extra, signal }),
          )
        : parsed;

      const execution = effectTool.execute(input, executionContext(extra));

      const { data } = yield* mapFailures === undefined
        ? execution
        : mapFailures(execution);

      const result = yield* step(() => toolResult(tool.id, data, params));

      yield* step(() => {
        assertOutputContract(tool, result);
      });

      return result;
    });
}

export const NEON_HANDLERS: ToolHandlers = Object.fromEntries(
  NEON_TOOLS.map((tool) => [tool.name, toolHandler(tool)]),
);
