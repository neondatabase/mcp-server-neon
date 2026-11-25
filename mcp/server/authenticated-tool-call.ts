import { Effect, Schema } from 'effect';
import { Analytics } from '../analytics/analytics-service';
import { ApiRoutes, CallApiRequest } from '../analytics/api-routes';
import { toolSpanClientAttributes } from '../sentry/tool-span';
import { setSentryTags } from '../sentry/utils';
import { invokeTool } from '../tools/registration';
import {
  authenticatedCall,
  toolCallProperties,
  trackServerInit,
  withAccessWarnings,
} from './authenticated-session';
import type { AuthenticatedServer } from './authenticated-session';
import type { ToolCall } from './register-tools';
import { renderToolCall } from './tool-call';
import type { ToolCallOutcome } from './tool-call';

type Caller = ReturnType<typeof authenticatedCall>;

type Properties = ReturnType<typeof toolCallProperties>;

const recordToolCall = (caller: Caller, properties: Properties) =>
  Effect.gen(function* () {
    const { context, agent } = caller;

    yield* Effect.logInfo('tool call:').pipe(Effect.annotateLogs(properties));
    yield* Effect.sync(() => {
      setSentryTags(context, agent);
    });
    yield* Effect.annotateCurrentSpan(toolSpanClientAttributes(agent));

    const analytics = yield* Analytics;

    yield* analytics.track({
      userId: context.account.id,
      event: 'tool_call',
      properties,
      context: {
        client: context.client,
        app: context.app,
        clientName: agent.clientName,
      },
    });
  });

const logToolError = ({ result }: ToolCallOutcome, properties: Properties) =>
  Effect.logWarning('tool error response:').pipe(
    Effect.annotateLogs({
      ...properties,
      isError: true,
      contentLength: result.content?.length,
      firstContentType: result.content?.[0]?.type,
    }),
  );

/** One authenticated tool call: tracked, logged, tagged, and run with the caller's key. */
export const authenticatedToolCall =
  (server: AuthenticatedServer): ToolCall =>
  ({ tool, args, ctx, traceId }) =>
    Effect.gen(function* () {
      const caller = yield* Effect.sync(() => authenticatedCall(server, ctx));
      const { context, grant, readOnly, agent, userAgent } = caller;

      yield* trackServerInit(caller, server.state);

      const callProperties = toolCallProperties(tool.name, caller, traceId);

      const properties =
        tool.name === 'call_api'
          ? {
              ...callProperties,
              ...(yield* (yield* ApiRoutes).forCall(
                Schema.decodeUnknownOption(CallApiRequest)(args),
              )),
            }
          : callProperties;

      yield* recordToolCall(caller, properties);

      const outcome = yield* renderToolCall(
        invokeTool(tool.name, args, grant, {
          account: context.account,
          readOnly,
          clientApplication: agent.clientApplication,
          apiKey: context.apiKey,
          userAgent,
        }),
        { properties, traceId, agent },
      );

      if (outcome.result.isError === true) {
        yield* logToolError(outcome, properties);
      }

      if (outcome.kind === 'success') {
        withAccessWarnings(outcome.result, caller);
      }

      return outcome;
    });
