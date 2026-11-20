import { Clock, Effect } from 'effect';
import type { DownstreamAuthRequest } from '../../mcp/oauth/downstream-auth-request';

/**
 * Auth-flow SLO outcome buckets emitted by /callback. Mirrors the refresh
 * SLO at /api/token (see ai-notes/refresh-slo.md). Bucket map:
 *
 *  GOOD (numerator):
 *  - `success`                   200/302 successful exchange + redirect
 *  - `correct_user_denied`       User clicked Cancel (Hydra `access_denied`)
 *  - `correct_consent_expired`   Hydra `request_unauthorized` — the
 *                                login/consent challenge DB row expired
 *                                (ttl.login_consent_request, 30m default
 *                                in Hydra v1.11.x). Counts GOOD because
 *                                the user took too long; system worked
 *                                as designed.
 *  - `correct_csrf_mismatch`     Hydra `request_forbidden` — CSRF cookie
 *                                value differs from the DB row, typically
 *                                because a concurrent OAuth flow on the
 *                                same host overwrote the cookie. Counts
 *                                GOOD because the CSRF guard correctly
 *                                rejected a corrupted flow; user retries
 *                                in a single tab and succeeds.
 *  - `correct_invalid_grant`     Hydra `invalid_grant` on code-exchange —
 *                                the authorization code was already used
 *                                or expired (ttl.auth_code, 10m default).
 *                                Mirrors the refresh SLO's same-named
 *                                bucket; system worked as designed.
 *  - `correct_chatgpt_invalid_request`
 *                                Hydra `invalid_request` on a flow whose
 *                                downstream `redirect_uri` is hosted at
 *                                `chatgpt.com`. ChatGPT's MCP-connector
 *                                OAuth uses a SHARED `client_id`
 *                                (`CKbabZGE` and friends) across all of
 *                                its end-users, and that shared registration
 *                                periodically lands in a degraded state on
 *                                Hydra's side that produces sustained
 *                                `invalid_request` rejections at the
 *                                /oauth2/auth step. Not actionable from our
 *                                side (the request shape WE send is uniform
 *                                and well-formed — `stateLen=404`,
 *                                `hasPKCE=1`, `hasResource=1` — verified
 *                                against multiple successful sessions on the
 *                                same connector). Bucketed separately from
 *                                `upstream_other_error` so the SLO isn't
 *                                punished for an upstream/integration issue
 *                                we can't fix unilaterally. Investigation
 *                                + evidence: ai-notes/3-day-slo-2026-05-21T14Z.md
 *                                §2 "Bad-event analysis".
 *
 *  BAD (numerator):
 *  - `upstream_unmapped_error`   Hydra returned `?error=error` with
 *                                description "The error is unrecognizable"
 *                                (Fosite-unmapped fallback). The canonical
 *                                fingerprint of a Hydra-side state issue
 *                                we can't classify; user is stranded.
 *  - `upstream_other_error`      Any other upstream OAuth error we haven't
 *                                explicitly classified. Counts BAD until
 *                                characterized — when a new fingerprint
 *                                shows up here often enough, promote it to
 *                                its own bucket (good or bad as appropriate).
 *  - `state_decode_failed`       Our own base64/JSON state could not be
 *                                parsed — our encoding broke or caller tampered.
 *  - `internal_error`            Everything else (KV failures, neon API
 *                                errors, unexpected throws).
 *
 *  EXCLUDED (not in denominator):
 *  - `upstream_5xx`              Hydra returned 5xx during code-exchange
 *                                (OAUTH_RESPONSE_IS_NOT_CONFORM) — provider
 *                                outage, not our quality.
 *  - `bad_request`               Bare GET to /callback without any of
 *                                code/state/error — direct navigation,
 *                                prefetch, browser history.
 *
 * Source-grounded justifications for the "correct_*" buckets live in
 * ai-notes/hydra-incident-2026-05-12T13-44Z.md §Update. See also
 * ai-notes/auth-callback-slo.md for the SLO definition + targets.
 */
type AuthCallbackOutcome =
  | 'success'
  | 'correct_user_denied'
  | 'correct_consent_expired'
  | 'correct_csrf_mismatch'
  | 'correct_invalid_grant'
  | 'correct_chatgpt_invalid_request'
  | 'upstream_unmapped_error'
  | 'upstream_5xx'
  | 'upstream_other_error'
  | 'state_decode_failed'
  | 'bad_request'
  | 'internal_error';

/**
 * Hydra's `error` description when the underlying failure can't be mapped to
 * a standard OAuth error code: the canonical fingerprint of a Hydra-side
 * internal-state issue (unmapped consent, session, or scope).
 */
const HYDRA_UNRECOGNIZABLE_ERROR_DESCRIPTION = 'The error is unrecognizable';

// Hydra rejected the request for a well-understood reason, and the user can
// retry and succeed without our intervention: the system worked as designed.
const CORRECT_REJECTIONS = new Map<string, AuthCallbackOutcome>([
  ['access_denied', 'correct_user_denied'],
  ['request_unauthorized', 'correct_consent_expired'],
  ['request_forbidden', 'correct_csrf_mismatch'],
  ['invalid_grant', 'correct_invalid_grant'],
]);

/**
 * Maps an upstream OAuth error (an `?error=` redirect or a code-exchange
 * failure) to its SLO bucket. `redirectUriHost` is unknown until the state is
 * decoded; without it the ChatGPT bucket can't fire and the event counts bad,
 * so callers re-classify once they have it.
 */
export const classifyUpstreamError = (input: {
  readonly error: string;
  readonly description: string | null;
  readonly status: number | undefined;
  readonly redirectUriHost?: string;
}): AuthCallbackOutcome => {
  const { error, description, status, redirectUriHost } = input;

  // A provider 5xx is outside the denominator whatever error Hydra attached.
  if (status !== undefined && status >= 500) {
    return 'upstream_5xx';
  }

  if (
    error === 'error' ||
    description === HYDRA_UNRECOGNIZABLE_ERROR_DESCRIPTION
  ) {
    return 'upstream_unmapped_error';
  }

  const correct = CORRECT_REJECTIONS.get(error);

  if (correct !== undefined) {
    return correct;
  }

  // ChatGPT's MCP connector shares one OAuth client_id across its users, and
  // that registration periodically degrades on Hydra's side into sustained
  // `invalid_request` rejections for requests verified well-formed. Not
  // actionable from our side, so it counts good, in its own bucket so the
  // rate stays observable.
  if (error === 'invalid_request' && redirectUriHost === 'chatgpt.com') {
    return 'correct_chatgpt_invalid_request';
  }

  return 'upstream_other_error';
};

/**
 * Privacy-safe summary of the downstream client's auth request, so a generic
 * Hydra `invalid_request` can be told apart from what we forwarded. Never the
 * raw `state`, an opaque transaction id: only its length and a short prefix.
 * The redirect host leaves out the port, which is per-process random and
 * PII-adjacent on a small user base.
 */
type DownstreamRequestSummary = {
  readonly stateLength: number;
  readonly stateFingerprint: string;
  readonly scopeCount: number;
  readonly redirectUriHost: string | undefined;
  readonly redirectUriPath: string | undefined;
  readonly hasResource: boolean;
  readonly hasCodeChallenge: boolean;
};

const parsedRedirect = (redirectUri: string) => {
  try {
    const url = new URL(redirectUri);

    return { host: url.hostname, path: url.pathname };
  } catch {
    return { host: undefined, path: undefined };
  }
};

export const summarizeDownstreamRequest = (input: {
  readonly state: string;
  readonly request: DownstreamAuthRequest;
}): DownstreamRequestSummary => {
  const { state, request } = input;
  const redirect = parsedRedirect(request.redirectUri);

  return {
    stateLength: state.length,
    stateFingerprint: `len=${state.length},prefix=${state.slice(0, 6)}`,
    scopeCount: request.scope.length,
    redirectUriHost: redirect.host,
    redirectUriPath: redirect.path,
    hasResource: (request.resource ?? '') !== '',
    hasCodeChallenge: (request.codeChallenge ?? '') !== '',
  };
};

type SloContext = {
  readonly clientId?: string;
  readonly upstreamError?: string;
  readonly upstreamStatus?: number;
  readonly reason?: string;
  readonly downstreamRequest?: DownstreamRequestSummary;
};

const field = (name: string, value: string | number | undefined) =>
  value === undefined || value === '' ? [] : [`${name}=${value}`];

const flag = (name: string, on: boolean) => (on ? [`${name}=1`] : []);

// Inline `key=value` fields rather than a JSON blob, so dashboards can grep
// fields like `stateLen=` directly.
const downstreamFields = (summary: DownstreamRequestSummary | undefined) =>
  summary === undefined
    ? []
    : [
        `stateLen=${summary.stateLength}`,
        `stateFp=${summary.stateFingerprint}`,
        `scopeCount=${summary.scopeCount}`,
        ...field('rURIHost', summary.redirectUriHost),
        ...field('rURIPath', summary.redirectUriPath),
        ...flag('hasResource', summary.hasResource),
        ...flag('hasPKCE', summary.hasCodeChallenge),
      ];

const sloFields = (input: {
  readonly outcome: AuthCallbackOutcome;
  readonly elapsedMs: number;
  readonly context: SloContext;
}) => {
  const { outcome, elapsedMs, context } = input;

  return [
    `outcome=${outcome}`,
    `elapsedMs=${elapsedMs}`,
    ...field('clientId', context.clientId),
    ...field('upstreamError', context.upstreamError),
    ...field('upstreamStatus', context.upstreamStatus),
    ...field('reason', context.reason),
    ...downstreamFields(context.downstreamRequest),
  ];
};

/** One `[SLO] auth-callback` line; dashboards parse its `key=value` fields. */
export const emitAuthCallbackSlo = Effect.fnUntraced(function* (input: {
  readonly outcome: AuthCallbackOutcome;
  readonly startedAt: number;
  readonly context?: SloContext;
}) {
  const now = yield* Clock.currentTimeMillis;

  const fields = sloFields({
    outcome: input.outcome,
    elapsedMs: now - input.startedAt,
    context: input.context ?? {},
  });

  yield* Effect.logInfo(`[SLO] auth-callback ${fields.join(' ')}`);
});
