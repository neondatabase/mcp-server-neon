import { NextRequest, NextResponse } from 'next/server';
import { SERVER_HOST } from '../../../lib/config';
import { model } from '../../../mcp/oauth/model';
import { upstreamAuth } from '../../../lib/oauth/client';
import { handleOAuthError } from '../../../lib/errors';
import { logger } from '../../../mcp/utils/logger';
import {
  admitDcrRedirectUris,
  matchesRedirectUri,
} from '../../../lib/oauth/redirect-uri';
import {
  consentCanonicalLocation,
  InvalidRequestOriginError,
  requestPublicOrigin,
} from '../../../mcp/oauth/consent-canonical-url';
import {
  DEFAULT_GRANT,
  resolveGrantFromResourceUri,
  type GrantContext,
} from '../../../mcp/utils/grant-context';
import { renderConsentHtml } from '../../../mcp/oauth/consent-dialog';
import { authTransactions } from '../../../mcp/oauth/auth-transaction-store';
import {
  consentCookieClearOptions,
  consentCookieName,
  consentCookieSetOptions,
  cookieSecureForRequest,
  isAuthTransactionId,
} from '../../../mcp/oauth/browser-binding';
import {
  confirmationApproval,
  confirmationCeiling,
  editableCeiling,
  parseConsentPost,
} from '../../../mcp/oauth/consent-approval';
import {
  consentModeFromResource,
  preferenceReadOnly,
  resourceReadOnlyHardCeiling,
} from '../../../mcp/oauth/consent-mode';
import {
  AUTH_RESTART_DESCRIPTION,
  CONSENT_HTML_HEADERS,
} from '../../../mcp/oauth/consent-html-headers';
import type { DownstreamAuthRequest } from '../../../mcp/oauth/downstream-auth-request';
import { issuedOauthScopes } from '../../../mcp/oauth/issued-scopes';

function parseAuthRequest(
  searchParams: URLSearchParams,
): DownstreamAuthRequest {
  const responseType = searchParams.get('response_type') || '';
  const clientId = searchParams.get('client_id') || '';
  const redirectUri = searchParams.get('redirect_uri') || '';
  const scope = searchParams.get('scope') || '';
  const state = searchParams.get('state') || '';
  const resource = searchParams.get('resource') || undefined;
  const codeChallenge = searchParams.get('code_challenge') || undefined;
  const codeChallengeMethod =
    searchParams.get('code_challenge_method') || 'plain';

  return {
    responseType,
    clientId,
    redirectUri,
    scope: scope.split(' ').filter(Boolean),
    state,
    resource,
    codeChallenge,
    codeChallengeMethod,
  };
}

function storedStringArray(
  record: Record<string, unknown>,
  field: string,
): string[] | undefined {
  const value = record[field];
  return Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string')
    ? value
    : undefined;
}

function storedRedirectUris(
  record: Record<string, unknown>,
): string[] | undefined {
  const value = record.redirect_uris;
  const candidates =
    typeof value === 'string'
      ? [value]
      : storedStringArray(record, 'redirect_uris');
  if (!candidates) return undefined;
  const { admitted } = admitDcrRedirectUris(candidates);
  return admitted.length > 0 ? admitted : undefined;
}

function consentClientFields(client: object): {
  client_name?: string;
  client_uri?: string;
  redirect_uris?: string[];
} {
  const record = Object.fromEntries(Object.entries(client));
  const clientName = record.client_name;
  const clientUri = record.client_uri;
  const redirectUris = storedRedirectUris(record);
  return {
    client_name: typeof clientName === 'string' ? clientName : undefined,
    client_uri: typeof clientUri === 'string' ? clientUri : undefined,
    redirect_uris: redirectUris,
  };
}

function jsonError(
  error: string,
  error_description: string,
  status = 400,
): NextResponse {
  return NextResponse.json({ error, error_description }, { status });
}

function restartError(): NextResponse {
  return jsonError('invalid_request', AUTH_RESTART_DESCRIPTION);
}

function readFormState(form: FormData): string | undefined {
  const values = form.getAll('state');
  if (values.length !== 1) {
    return undefined;
  }
  const value = values[0];
  if (typeof value !== 'string') {
    return undefined;
  }
  return value;
}

function browserSecretFromRequest(
  request: NextRequest,
  transactionId: string,
): string | undefined {
  return request.cookies.get(consentCookieName(transactionId))?.value;
}

function cancelRedirect(
  redirectUri: string,
  downstreamState: string,
): NextResponse {
  const url = new URL(redirectUri);
  url.searchParams.set('error', 'access_denied');
  if (downstreamState) {
    url.searchParams.set('state', downstreamState);
  }
  return NextResponse.redirect(url, 303);
}

function applyCookie(
  response: NextResponse,
  transactionId: string,
  browserSecret: string,
  request: NextRequest,
  expiresAt: Date,
): NextResponse {
  response.cookies.set(
    consentCookieName(transactionId),
    browserSecret,
    consentCookieSetOptions(cookieSecureForRequest(request), expiresAt),
  );
  return response;
}

function clearCookie(
  response: NextResponse,
  transactionId: string,
  request: NextRequest,
): NextResponse {
  response.cookies.set(
    consentCookieName(transactionId),
    '',
    consentCookieClearOptions(cookieSecureForRequest(request)),
  );
  return response;
}

function htmlConsent(
  html: string,
  extra?: {
    transactionId: string;
    browserSecret: string;
    request: NextRequest;
    expiresAt: Date;
  },
): NextResponse {
  const response = new NextResponse(html, {
    headers: CONSENT_HTML_HEADERS,
  });
  if (extra) {
    applyCookie(
      response,
      extra.transactionId,
      extra.browserSecret,
      extra.request,
      extra.expiresAt,
    );
  }
  return response;
}

export async function GET(request: NextRequest) {
  try {
    const canonical = consentCanonicalLocation(
      requestPublicOrigin(request),
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
      SERVER_HOST,
    );
    if (canonical) {
      return NextResponse.redirect(canonical, 302);
    }

    const searchParams = request.nextUrl.searchParams;
    const requestParams = parseAuthRequest(searchParams);
    let resourceGrant: GrantContext = { ...DEFAULT_GRANT };
    try {
      resourceGrant = resolveGrantFromResourceUri(requestParams.resource);
    } catch {
      return jsonError('invalid_target', 'Invalid resource parameter');
    }

    const mode = consentModeFromResource(requestParams.resource);
    const resourceReadOnlyHard = resourceReadOnlyHardCeiling(
      requestParams.resource,
    );
    const clientId = requestParams.clientId;
    const client = await model.getClient(clientId, '');

    logger.info('Authorize request', {
      clientId,
      redirectUri: requestParams.redirectUri,
      responseType: requestParams.responseType,
      scope: requestParams.scope,
    });

    const savedRegisterHeaders = await model.getClientRegisterHeaders(clientId);
    const savedHeaders = savedRegisterHeaders?.headers ?? {};
    const prefReadOnly = preferenceReadOnly({
      authorizeReadOnly: searchParams.get('readonly'),
      headerValue:
        request.headers.get('x-read-only') ??
        savedHeaders['x-read-only'] ??
        null,
    });

    if (!client) {
      logger.warn('Client not found', { clientId });
      return jsonError('invalid_client', 'Invalid client ID');
    }

    const clientRecord = Object.fromEntries(Object.entries(client));
    const responseTypes = storedStringArray(clientRecord, 'response_types');
    const registeredRedirectUris = storedRedirectUris(clientRecord);
    if (!responseTypes || !registeredRedirectUris) {
      logger.warn('Invalid stored client metadata', { clientId });
      return jsonError('invalid_client', 'Invalid client metadata');
    }

    if (!responseTypes.includes(requestParams.responseType)) {
      logger.warn('Invalid response type', {
        clientId,
        providedResponseType: requestParams.responseType,
        supportedResponseTypes: responseTypes,
      });
      return jsonError('unsupported_response_type', 'Invalid response type');
    }

    if (
      !matchesRedirectUri(requestParams.redirectUri, registeredRedirectUris)
    ) {
      logger.warn('Invalid redirect URI', {
        clientId: requestParams.clientId,
        providedRedirectUri: requestParams.redirectUri,
        registeredRedirectUris,
      });
      return jsonError('invalid_request', 'Invalid redirect URI');
    }

    const ceiling =
      mode === 'confirmation'
        ? confirmationCeiling({
            resourceGrant,
            requestScopes: requestParams.scope,
            resourceReadOnlyHard,
          })
        : editableCeiling(requestParams.scope);

    const created = await authTransactions.createPending({
      request: requestParams,
      mode,
      ceiling,
      defaultReadOnly: prefReadOnly,
      resourceGrant,
      resourceReadOnlyHard,
    });

    const writeChecked =
      mode === 'confirmation'
        ? confirmationApproval({
            resourceGrant,
            requestScopes: requestParams.scope,
            resourceReadOnlyHard,
          }).writeGranted
        : ceiling.writeAllowed && !prefReadOnly;

    const html = renderConsentHtml({
      client: consentClientFields(client),
      state: created.transaction.id,
      mode,
      writeChecked,
      showWriteControl: mode === 'editable' && ceiling.writeAllowed,
      grant: resourceGrant,
    });
    return htmlConsent(html, {
      transactionId: created.transaction.id,
      browserSecret: created.browserSecret,
      request,
      expiresAt: created.transaction.expiresAt,
    });
  } catch (error: unknown) {
    if (error instanceof InvalidRequestOriginError) {
      return jsonError('invalid_request', error.message);
    }
    return handleOAuthError(error, 'Authorization error');
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const transactionId = readFormState(formData);
    if (!transactionId || !isAuthTransactionId(transactionId)) {
      return restartError();
    }

    const browserSecret = browserSecretFromRequest(request, transactionId);
    if (!browserSecret) {
      return restartError();
    }

    const pending = await authTransactions.getPending(
      transactionId,
      browserSecret,
    );
    if (!pending) {
      return restartError();
    }

    const parsed = parseConsentPost({
      form: formData,
      mode: pending.mode,
      ceiling: pending.ceiling,
    });

    if (parsed.action === 'cancel') {
      const consumed = await authTransactions.consumePending(
        transactionId,
        browserSecret,
      );
      if (!consumed) {
        return restartError();
      }
      return clearCookie(
        cancelRedirect(consumed.request.redirectUri, consumed.request.state),
        transactionId,
        request,
      );
    }

    if (parsed.action === 'invalid') {
      if (parsed.error.kind === 'field') {
        const client = await model.getClient(pending.request.clientId, '');
        if (!client) {
          return jsonError('invalid_client', 'Invalid client ID');
        }
        const html = renderConsentHtml({
          client: consentClientFields(client),
          state: pending.id,
          mode: pending.mode,
          writeChecked: parsed.error.selection.grantWrite,
          showWriteControl: pending.ceiling.writeAllowed,
          grant: pending.resourceGrant,
          fieldError: {
            field: parsed.error.field,
            message: parsed.error.message,
          },
          formState: {
            projectMode: parsed.error.selection.projectMode,
            projectId: parsed.error.selection.projectId,
            categories: parsed.error.selection.categories,
            writeChecked: parsed.error.selection.grantWrite,
          },
        });
        return htmlConsent(html);
      }
      return jsonError(parsed.error.kind, parsed.error.description);
    }

    let approvedGrant: GrantContext;
    let approvedScopes: string[];
    if (parsed.confirmation) {
      const approval = confirmationApproval({
        resourceGrant: pending.resourceGrant,
        requestScopes: pending.request.scope,
        resourceReadOnlyHard: pending.resourceReadOnlyHard,
      });
      approvedGrant = approval.grant;
      approvedScopes = approval.scopes;
    } else {
      approvedGrant = parsed.selection.grant;
      approvedScopes = issuedOauthScopes({
        requestedScopes: pending.request.scope,
        grantWrite: parsed.selection.grantWrite,
      });
    }

    const approved = await authTransactions.approvePending({
      id: transactionId,
      browserSecret,
      approvedGrant,
      approvedScopes,
    });
    if (!approved) {
      return restartError();
    }

    const authUrl = await upstreamAuth(approved.id);
    return NextResponse.redirect(authUrl.href, 303);
  } catch (error: unknown) {
    return handleOAuthError(error, 'Authorization error');
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
