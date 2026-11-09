import { waitUntil } from '@vercel/functions';
import { NextResponse, type NextRequest } from 'next/server';
import { flushAnalytics, track } from '../analytics/analytics';
import { identifyClient } from '../utils/client-application';
import {
  nativeAppRedirect,
  renderAuthCompletePage,
  type AuthCompleteOutcome,
  type AuthCompletePageProps,
} from './auth-complete-page';
import { signPageView } from './auth-complete-page-view';

const SERVER_FAILURE_MESSAGE =
  'Neon could not finish authorization right now. Start again from your app.';
const RETRY_MESSAGE =
  'Neon could not finish authorization right now. Reload this page in a moment to try again.';

// Relayed OAuth errors that mean the server failed, not the request.
const TEMPORARY_ERRORS = new Set(['server_error', 'temporarily_unavailable']);

/** What /callback knows about the request the page is for. */
type CompletionContext = {
  userId?: string;
  clientId?: string;
  clientName?: string;
  /**
   * The OAuth error /callback relayed to the client. Never read it back from
   * the redirect: the client chose its redirect_uri, query string included.
   */
  relayedError?: string;
  /** Failed before the one-time transaction was used up, so a reload can retry. */
  retryable?: boolean;
};

const completionContexts = new WeakMap<NextResponse, CompletionContext>();

/** Tags a /callback response with the context its completion page reports. */
export function withCompletionContext(
  response: NextResponse,
  context: CompletionContext,
): NextResponse {
  completionContexts.set(response, context);
  return response;
}

/**
 * In a browser, native-app redirects (cursor://, claude://) and failures get a
 * completion page instead of a bare redirect or JSON body. Web redirects and
 * non-browser callers keep the original response.
 */
export async function presentToBrowser(
  request: NextRequest,
  response: NextResponse,
): Promise<NextResponse> {
  if (!request.headers.get('accept')?.includes('text/html')) {
    return response;
  }

  const context = completionContexts.get(response);
  const isRedirect = response.status >= 300 && response.status < 400;
  const appRedirect = isRedirect
    ? nativeAppRedirect(response.headers.get('location'))
    : undefined;
  // Only a redirect /callback tagged gets a page, so its outcome is known.
  if (appRedirect && context) {
    const error = context.relayedError;
    return completionPage(response, 200, {
      outcome: error ? failureOutcome(error) : 'success',
      message:
        error && TEMPORARY_ERRORS.has(error)
          ? SERVER_FAILURE_MESSAGE
          : undefined,
      returnUrl: appRedirect.href,
    });
  }

  const isJson = response.headers
    .get('content-type')
    ?.includes('application/json');
  if (response.status < 400 || !isJson) {
    return response;
  }

  const query = request.nextUrl.searchParams;
  if (!query.has('code') && !query.has('state') && !query.has('error')) {
    return completionPage(response, response.status, { outcome: 'none' });
  }

  // The JSON keeps its detail for developers. The page only shows fixed text:
  // error_description is often relayed from the query string, where anyone
  // can put words on a Neon-branded page.
  const body: { error?: unknown } = await response
    .clone()
    .json()
    .catch(() => ({}));
  const retryable = context?.retryable === true;
  return completionPage(response, response.status, {
    outcome: failureOutcome(body.error),
    message: retryable
      ? RETRY_MESSAGE
      : response.status >= 500
        ? SERVER_FAILURE_MESSAGE
        : undefined,
    retryable,
  });
}

function failureOutcome(error: unknown): AuthCompleteOutcome {
  return error === 'access_denied' ? 'cancelled' : 'failed';
}

type CompletionPageProps = Omit<
  AuthCompletePageProps,
  'nonce' | 'pageViewId' | 'pageViewToken'
>;

function completionPage(
  original: NextResponse,
  status: number,
  props: CompletionPageProps,
): NextResponse {
  // A page with no authorization in it is not a view worth counting, and
  // without a page view its script sends no action events.
  const pageView = props.outcome === 'none' ? {} : trackView(original, props);
  const { html, headers } = renderAuthCompletePage({ ...props, ...pageView });
  const page = new NextResponse(html, { status, headers });
  const retryAfter = original.headers.get('retry-after');
  if (retryAfter !== null) {
    page.headers.set('retry-after', retryAfter);
  }
  for (const cookie of original.headers.getSetCookie()) {
    page.headers.append('set-cookie', cookie);
  }
  return page;
}

function trackView(
  original: NextResponse,
  props: CompletionPageProps,
): { pageViewId: string; pageViewToken: string } {
  const pageViewId = crypto.randomUUID();
  const context = completionContexts.get(original) ?? {};
  // anonymousId is the page view so the browser's action events, which only
  // know the page view, join to this user without the page holding identity.
  track({
    ...(context.userId ? { userId: context.userId } : {}),
    anonymousId: pageViewId,
    event: 'auth_complete_viewed',
    properties: {
      pageViewId,
      outcome: props.outcome,
      opensApp: Boolean(props.returnUrl),
      clientId: context.clientId,
      clientName: context.clientName,
      clientApplication: identifyClient(undefined, context.clientName)
        .clientApplication,
    },
  });
  waitUntil(flushAnalytics());
  return { pageViewId, pageViewToken: signPageView(pageViewId) };
}
