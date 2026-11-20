import { Effect, Option, Schema, Stream } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { Analytics } from '../../../mcp/analytics/analytics-service';
import { AUTH_COMPLETE_ACTIONS } from '../../../mcp/oauth/auth-complete-page';
import { requestPublicOrigin } from '../../../mcp/oauth/consent-canonical-url';

const MAX_BODY_BYTES = 256;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const ActionBeacon = Schema.fromJsonString(
  Schema.Struct({
    pageViewId: Schema.String.check(Schema.isPattern(UUID)),
    action: Schema.Literals(AUTH_COMPLETE_ACTIONS),
  }),
);

/** The beacon body is longer than `MAX_BODY_BYTES`. */
class BeaconTooLarge extends Schema.TaggedError<
  BeaconTooLarge,
  { readonly brand: unique symbol }
>()('BeaconTooLarge', {}) {}

type BodyChunks = { readonly size: number; readonly chunks: Uint8Array[] };

const appendChunk = (body: BodyChunks, chunk: Uint8Array) => {
  const size = body.size + chunk.byteLength;

  return size > MAX_BODY_BYTES
    ? Effect.fail(BeaconTooLarge.make({}))
    : Effect.succeed({ size, chunks: [...body.chunks, chunk] });
};

/**
 * Reads at most `MAX_BODY_BYTES`, whatever Content-Length says or whether it
 * is sent at all; reading stops at the chunk that crosses the limit.
 */
const boundedBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const webRequest = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);

  // A request without a body has no stream; it decodes like an empty body and
  // is answered 400. A stream that fails while it is read is not caught.
  if (webRequest.body === null) {
    return '';
  }

  const body = yield* request.stream.pipe(
    Stream.runFoldEffect(
      (): BodyChunks => ({ size: 0, chunks: [] }),
      appendChunk,
    ),
  );

  return Buffer.concat(body.chunks).toString('utf8');
});

// Firefox sends `Origin: null` under the page's no-referrer policy, so the
// browser's own Sec-Fetch-Site also counts as proof of a same-origin page.
const isSameOrigin = (request: HttpServerRequest.HttpServerRequest) =>
  request.headers.origin ===
    requestPublicOrigin({
      nextUrl: new URL(request.originalUrl),
      headers: new Headers(request.headers),
    }) || request.headers['sec-fetch-site'] === 'same-origin';

const empty = (status: number) => HttpServerResponse.empty({ status });

const recordAction = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;

  if (!isSameOrigin(request)) {
    return empty(403);
  }

  const body = yield* boundedBody;
  const beacon = Schema.decodeOption(ActionBeacon)(body);

  if (Option.isNone(beacon)) {
    return empty(400);
  }

  const { pageViewId, action } = beacon.value;
  const analytics = yield* Analytics;

  yield* analytics.track({
    anonymousId: pageViewId,
    event: 'auth_complete_action',
    properties: { pageViewId, action },
  });

  return empty(204);
});

/**
 * POST /api/auth-complete/events: action beacons from the auth completion
 * page. Unauthenticated by design, like any client-side analytics beacon: the
 * page holds no identity, only the page view id that joins these events to its
 * auth_complete_viewed event.
 */
const authCompleteEvents = recordAction.pipe(
  Effect.catchTag('BeaconTooLarge', () => Effect.succeed(empty(413))),
  Effect.withSpan('AuthCompleteEvents.record'),
);

export const AuthCompleteEventsRoutes = HttpRouter.add(
  'POST',
  '/api/auth-complete/events',
  authCompleteEvents,
);
