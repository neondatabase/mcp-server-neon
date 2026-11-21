import { Effect, Predicate } from 'effect';
import { assert } from '../../lib/assert';
import { Analytics } from '../analytics/analytics-service';
import { toolSpanClientAttributes } from '../sentry/tool-span';
import { NEON_HANDLERS } from '../tools/tools';
import type { IdentifiedClient } from '../utils/client-application';
import { DEFAULT_SECRETS } from '../utils/secrets';
import { appContext } from './mcp-request';
import type { ToolCall } from './register-tools';
import { renderToolCall } from './tool-call';

const ANONYMOUS_DOCS_USER_ID = 'anonymous-docs';

const docsToolProperties = (
  toolName: string,
  agent: IdentifiedClient,
  traceId: string,
) => ({
  authMethod: 'anonymous',
  toolName,
  tool_name: toolName,
  readOnly: 'true',
  projectScoped: 'false',
  customScopes: 'docs',
  rolePinned: 'false',
  secrets: DEFAULT_SECRETS,
  clientName: agent.clientName,
  clientApplication: agent.clientApplication,
  traceId,
  docsOnly: 'true',
});

const runDocsTool = (
  {
    toolName,
    args,
    traceId,
  }: {
    readonly toolName: string;
    readonly args: unknown;
    readonly traceId: string;
  },
  agent: IdentifiedClient,
  userAgent: string | undefined,
) => {
  const handler = NEON_HANDLERS[toolName];
  const properties = docsToolProperties(toolName, agent, traceId);

  assert(handler !== undefined, `Handler for tool ${toolName} not found`);
  assert(Predicate.isObject(args), `${toolName} arguments were not validated`);

  return renderToolCall(
    handler(
      { params: { ...args } },
      {
        readOnly: true,
        clientApplication: agent.clientApplication,
        userAgent,
      },
    ),
    { properties, traceId, agent },
  );
};

/**
 * One anonymous `?category=docs` tool call. The docs tools call neon.com, the
 * feedback service, or neonstatus.com, so they run with no credential.
 */
export const docsToolCall =
  (agent: IdentifiedClient, userAgent: string | undefined): ToolCall =>
  ({ tool, args, traceId }) =>
    Effect.gen(function* () {
      yield* Effect.annotateCurrentSpan({
        ...toolSpanClientAttributes(agent),
        docs_only: true,
      });

      const properties = docsToolProperties(tool.name, agent, traceId);

      yield* Effect.logInfo('tool call (docs-only):').pipe(
        Effect.annotateLogs(properties),
      );

      const analytics = yield* Analytics;

      yield* analytics.track({
        anonymousId: ANONYMOUS_DOCS_USER_ID,
        event: 'tool_call',
        properties,
        context: { app: appContext() },
      });

      const outcome = yield* Effect.suspend(() =>
        runDocsTool({ toolName: tool.name, args, traceId }, agent, userAgent),
      );

      if (outcome.kind !== 'success') {
        yield* Effect.logWarning('tool error response (docs-only):').pipe(
          Effect.annotateLogs({
            ...properties,
            isError: true,
            contentLength: outcome.result.content?.length,
            firstContentType: outcome.result.content?.[0]?.type,
          }),
        );
      }

      return outcome;
    });
