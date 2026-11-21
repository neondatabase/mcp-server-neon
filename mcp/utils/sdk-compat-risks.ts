import { isLegacyRequest } from '@modelcontextprotocol/server';
import { Effect, Option, Predicate } from 'effect';

// @modelcontextprotocol/server 2.0.0 serves both request shapes logged here;
// 2.2.0 answers both with 400. A request the current handler already rejects
// is not logged, since the upgrade changes nothing for it.
const MAX_BATCH_SIZE = 100;

type SdkCompatRisk = {
  message: string;
  fields: Record<string, string | number | undefined>;
};

const isRequestMessage = Predicate.and(
  Predicate.hasProperty('id'),
  Predicate.hasProperty('method'),
);

// The MCP handler answers an unparseable body with its own 400.
const jsonBody = (req: Request) =>
  Effect.promise(async (): Promise<Option.Option<unknown>> => {
    try {
      const body: unknown = await req.clone().json();

      return Option.some(body);
    } catch {
      return Option.none();
    }
  });

const findSdkCompatRisk = Effect.fnUntraced(function* (req: Request) {
  if (req.method !== 'POST') {
    return Option.none<SdkCompatRisk>();
  }

  const parsed = yield* jsonBody(req);

  if (Option.isNone(parsed)) {
    return Option.none<SdkCompatRisk>();
  }

  const body = parsed.value;
  const userAgent = req.headers.get('user-agent') ?? undefined;

  if (Array.isArray(body) && body.length > MAX_BATCH_SIZE) {
    return Option.some<SdkCompatRisk>({
      message: 'MCP batch over 100 messages',
      fields: { batchSize: body.length, userAgent },
    });
  }

  if (
    isRequestMessage(body) &&
    !req.headers.has('mcp-protocol-version') &&
    !(yield* Effect.promise(async () => isLegacyRequest(req, body)))
  ) {
    return Option.some<SdkCompatRisk>({
      message: 'MCP 2026-07-28 request without MCP-Protocol-Version',
      fields: { method: req.headers.get('mcp-method') ?? undefined, userAgent },
    });
  }

  return Option.none<SdkCompatRisk>();
});

/** Serves the request, then logs a shape the next SDK release would reject. */
export const withSdkCompatRiskLog = Effect.fnUntraced(function* <E, R>(
  req: Request,
  serve: Effect.Effect<Response, E, R>,
) {
  const risk = yield* findSdkCompatRisk(req);
  const response = yield* serve;

  if (Option.isSome(risk) && response.ok) {
    yield* Effect.logWarning(risk.value.message).pipe(
      Effect.annotateLogs(risk.value.fields),
    );
  }

  return response;
});
