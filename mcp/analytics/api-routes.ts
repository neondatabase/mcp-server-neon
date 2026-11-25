import { parseApiPath } from '@neon/sdk';
import {
  describeEndpoint,
  EndpointNotFoundError,
  fetchOpenApiSpec,
} from '@neon/sdk/openapi';
import type { OpenApiSpec } from '@neon/sdk/openapi';
import {
  Cache,
  Context,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Schema,
} from 'effect';
import { NEON_API_SPEC_URL } from '../../lib/config';
import { ApiSpecUnavailable } from './api-spec-unavailable';

/** The `call_api` arguments route tracking reads. */
export const CallApiRequest = Schema.Struct({
  method: Schema.Literals(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: Schema.String,
});

type CallApiRequest = typeof CallApiRequest.Type;

/**
 * What `tool_call` records about a `call_api` request. `apiRoute` is a path
 * template from the spec, never the concrete path, which can hold role,
 * database, and domain names. `unmatched` is a path the spec has no route for,
 * or one `call_api` refuses; `spec_unavailable` means the spec could not be
 * read or resolved for the path, so the route is unknown. `invalid` is a call
 * whose arguments the tool would reject.
 */
type CallApiRoute = {
  readonly apiMethod: CallApiRequest['method'] | 'invalid';
  readonly apiRoute: string;
};

const INVALID_CALL: CallApiRoute = {
  apiMethod: 'invalid',
  apiRoute: 'unmatched',
};

/** The route of a decoded `call_api` request, given the spec, or `undefined` when the spec is unknown. */
export const callApiRoute = (
  { method, path }: CallApiRequest,
  spec: OpenApiSpec | undefined,
): CallApiRoute => {
  if (parseApiPath(path).error !== undefined) {
    return { apiMethod: method, apiRoute: 'unmatched' };
  }

  if (spec === undefined) {
    return { apiMethod: method, apiRoute: 'spec_unavailable' };
  }

  try {
    return {
      apiMethod: method,
      apiRoute: describeEndpoint(spec, path, method).path,
    };
  } catch (error) {
    if (error instanceof EndpointNotFoundError) {
      return { apiMethod: method, apiRoute: 'unmatched' };
    }

    throw error;
  }
};

const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

// Analytics must not hold a tool call for the spec's own 10-second timeout.
const SPEC_WAIT = Duration.seconds(2);

const unknownRoute = (request: CallApiRequest, reason: string) =>
  Effect.logWarning(
    'call_api route unknown: the OpenAPI spec is unavailable',
  ).pipe(
    Effect.annotateLogs({ reason }),
    Effect.as(callApiRoute(request, undefined)),
  );

const fetchSpec = (url: string) =>
  Effect.tryPromise({
    try: async (signal) => fetchOpenApiSpec({ url, signal }),
    catch: (cause) => ApiSpecUnavailable.make({ message: messageOf(cause) }),
  }).pipe(Effect.withSpan('ApiRoutes.fetchSpec', { attributes: { url } }));

/** Resolves `call_api` requests to spec route templates for `tool_call`. */
export class ApiRoutes extends Context.Service<
  ApiRoutes,
  {
    readonly forCall: (
      request: Option.Option<CallApiRequest>,
    ) => Effect.Effect<CallApiRoute>;
  }
>()('@neondatabase/mcp-server-neon/mcp/analytics/api-routes/ApiRoutes', {
  make: Effect.gen(function* () {
    const specs = yield* Cache.makeWith(fetchSpec, {
      capacity: 1,
      // A failed or interrupted fetch is retried on the next call_api.
      timeToLive: (exit) =>
        Exit.isSuccess(exit) ? Duration.hours(1) : Duration.zero,
    });

    const routeOf = (request: CallApiRequest) =>
      Cache.get(specs, NEON_API_SPEC_URL).pipe(
        Effect.timeout(SPEC_WAIT),
        Effect.flatMap((spec) =>
          Effect.try({
            try: () => callApiRoute(request, spec),
            catch: (cause) =>
              ApiSpecUnavailable.make({ message: messageOf(cause) }),
          }),
        ),
        Effect.catchTags({
          ApiSpecUnavailable: ({ message }) => unknownRoute(request, message),
          TimeoutError: () =>
            unknownRoute(
              request,
              `no spec within ${Duration.format(SPEC_WAIT)}`,
            ),
        }),
      );

    const forCall = Effect.fn('ApiRoutes.forCall')(function* (
      request: Option.Option<CallApiRequest>,
    ) {
      const route = Option.isSome(request)
        ? yield* routeOf(request.value)
        : INVALID_CALL;

      yield* Effect.annotateCurrentSpan({
        'neon.api.method': route.apiMethod,
        'neon.api.route': route.apiRoute,
      });

      return route;
    });

    return { forCall };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
