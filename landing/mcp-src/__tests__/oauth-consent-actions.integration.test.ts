import { describe, it, expect, vi, beforeEach } from 'vitest';

// `lib/config` and `next/navigation.redirect` need to be intercepted at
// module load time, so the mocks have to be hoisted ahead of the
// imports that pick them up. The `vi.hoisted` block exposes the test
// constants and the redirect-capture helper to the hoisted factories.
const { TEST_COOKIE_SECRET, redirectCalls } = vi.hoisted(() => ({
  TEST_COOKIE_SECRET: 'consent-action-tests-cookie-secret',
  redirectCalls: [] as string[],
}));

vi.mock('../../lib/config', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/config')>(
      '../../lib/config',
    );
  return { ...actual, COOKIE_SECRET: TEST_COOKIE_SECRET };
});

class TestRedirect extends Error {
  constructor(public readonly url: string) {
    super(`__redirect__:${url}`);
    this.name = 'TestRedirect';
  }
}

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    redirectCalls.push(url);
    // The real `redirect()` throws a Next-internal sentinel error so the
    // calling Server Action stops executing. We mirror that with a typed
    // sentinel each test can catch and inspect.
    throw new TestRedirect(url);
  },
  notFound: () => {
    throw new Error('TestNotFound');
  },
}));

vi.mock('../oauth/model', () => ({
  model: {
    getClient: vi.fn(),
    saveClientAuthContext: vi.fn(),
  },
}));

vi.mock('../../lib/oauth/cookies', () => ({
  updateApprovedClientsCookie: vi.fn(),
}));

vi.mock('../../lib/oauth/client', () => ({
  upstreamAuth: vi.fn(async () => new URL('https://oauth.example/authorize')),
}));

import { approveConsent, cancelConsent } from '../../app/oauth/consent/actions';
import { model } from '../oauth/model';
import { updateApprovedClientsCookie } from '../../lib/oauth/cookies';
import { upstreamAuth } from '../../lib/oauth/client';
import { signState } from '../../lib/oauth/state';
import type { ConsentSignedPayload } from '../../app/oauth/consent/types';

const VALID_CLIENT = {
  id: 'client-consent-test',
  client_name: 'Consent Action Test Client',
  redirect_uris: ['http://127.0.0.1:55667/callback'],
  response_types: ['code'],
  grant_types: ['authorization_code', 'refresh_token'],
  tokenEndpointAuthMethod: 'none',
  secret: '',
};

type AuthRequest = ConsentSignedPayload['authRequest'];

const baseAuthRequest = (
  overrides: Partial<AuthRequest> = {},
): AuthRequest => ({
  responseType: 'code',
  clientId: VALID_CLIENT.id,
  redirectUri: VALID_CLIENT.redirect_uris[0],
  scope: ['read', 'write'],
  state: 'downstream-state',
  codeChallengeMethod: 'plain',
  ...overrides,
});

const buildSignedState = async (
  overrides: Partial<ConsentSignedPayload> = {},
  authRequestOverrides: Partial<AuthRequest> = {},
): Promise<string> => {
  const payload: ConsentSignedPayload = {
    authRequest: baseAuthRequest(authRequestOverrides),
    requestedScope: ['read', 'write'],
    defaultReadOnly: false,
    iat: Date.now(),
    ...overrides,
  };
  return signState(payload, TEST_COOKIE_SECRET);
};

const formData = (
  entries: Record<string, string | string[] | undefined>,
): FormData => {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    if (Array.isArray(value)) {
      for (const v of value) fd.append(key, v);
    } else if (value !== undefined) {
      fd.set(key, value);
    }
  }
  return fd;
};

const captureRedirect = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
  } catch (err) {
    if (err instanceof TestRedirect) return err.url;
    throw err;
  }
  throw new Error('Server Action returned without redirecting');
};

describe('approveConsent', () => {
  beforeEach(() => {
    redirectCalls.length = 0;
    vi.clearAllMocks();
    vi.mocked(model.getClient).mockResolvedValue(
      VALID_CLIENT as unknown as Awaited<ReturnType<typeof model.getClient>>,
    );
    vi.mocked(model.saveClientAuthContext).mockResolvedValue({
      grant: { projectId: null, scopes: null },
      scope: ['read', 'write'],
      readOnly: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never);
    vi.mocked(updateApprovedClientsCookie).mockResolvedValue();
    vi.mocked(upstreamAuth).mockResolvedValue(
      new URL('https://oauth.example/authorize'),
    );
  });

  it('saves the default unconstrained grant and redirects upstream', async () => {
    const state = await buildSignedState();
    const url = await captureRedirect(() =>
      approveConsent(
        formData({
          signedState: state,
          categoriesAll: 'true',
          readonly: 'false',
        }),
      ),
    );

    expect(url).toBe('https://oauth.example/authorize');
    expect(model.saveClientAuthContext).toHaveBeenCalledWith(VALID_CLIENT.id, {
      grant: { projectId: null, scopes: null },
      scope: ['read', 'write'],
      readOnly: false,
    });
    expect(updateApprovedClientsCookie).toHaveBeenCalledWith(
      VALID_CLIENT.id,
      TEST_COOKIE_SECRET,
    );
  });

  it('persists narrowed categories and projectId from the form', async () => {
    const state = await buildSignedState();
    await captureRedirect(() =>
      approveConsent(
        formData({
          signedState: state,
          categoriesAll: 'false',
          categories: ['querying', 'schema'],
          projectId: 'prj_demo_42',
          readonly: 'false',
        }),
      ),
    );

    expect(model.saveClientAuthContext).toHaveBeenCalledWith(VALID_CLIENT.id, {
      grant: { projectId: 'prj_demo_42', scopes: ['querying', 'schema'] },
      scope: ['read', 'write'],
      readOnly: false,
    });
  });

  it('honors the read-only toggle by saving scope=[read]', async () => {
    const state = await buildSignedState();
    await captureRedirect(() =>
      approveConsent(
        formData({
          signedState: state,
          categoriesAll: 'true',
          readonly: 'true',
        }),
      ),
    );

    expect(model.saveClientAuthContext).toHaveBeenCalledWith(VALID_CLIENT.id, {
      grant: { projectId: null, scopes: null },
      scope: ['read'],
      readOnly: true,
    });
  });

  it('drops invalid category values silently', async () => {
    const state = await buildSignedState();
    await captureRedirect(() =>
      approveConsent(
        formData({
          signedState: state,
          categoriesAll: 'false',
          categories: ['querying', 'definitely-not-a-real-category'],
          readonly: 'false',
        }),
      ),
    );

    expect(model.saveClientAuthContext).toHaveBeenCalledWith(VALID_CLIENT.id, {
      grant: { projectId: null, scopes: ['querying'] },
      scope: ['read', 'write'],
      readOnly: false,
    });
  });

  it('treats an empty/whitespace-only projectId as null', async () => {
    const state = await buildSignedState();
    await captureRedirect(() =>
      approveConsent(
        formData({
          signedState: state,
          categoriesAll: 'true',
          projectId: '   ',
          readonly: 'false',
        }),
      ),
    );

    expect(model.saveClientAuthContext).toHaveBeenCalledWith(VALID_CLIENT.id, {
      grant: { projectId: null, scopes: null },
      scope: ['read', 'write'],
      readOnly: false,
    });
  });

  describe('narrowing-only policy', () => {
    it('intersects user categories with the client-locked subset', async () => {
      const state = await buildSignedState(
        {},
        {
          resource:
            'https://mcp.neon.tech/mcp?category=querying&category=schema',
        },
      );
      await captureRedirect(() =>
        approveConsent(
          formData({
            signedState: state,
            categoriesAll: 'false',
            // User tries to add `branches` which the client did NOT request.
            categories: ['querying', 'branches'],
            readonly: 'false',
          }),
        ),
      );

      // `branches` is filtered out by the intersection step.
      expect(model.saveClientAuthContext).toHaveBeenCalledWith(
        VALID_CLIENT.id,
        {
          grant: { projectId: null, scopes: ['querying'] },
          scope: ['read', 'write'],
          readOnly: false,
        },
      );
    });

    it('forces the projectId to the client-pinned value', async () => {
      const state = await buildSignedState(
        {},
        {
          resource: 'https://mcp.neon.tech/mcp?projectId=prj_pinned',
        },
      );
      await captureRedirect(() =>
        approveConsent(
          formData({
            signedState: state,
            categoriesAll: 'true',
            // User tries to override the pinned projectId.
            projectId: 'prj_attacker',
            readonly: 'false',
          }),
        ),
      );

      expect(model.saveClientAuthContext).toHaveBeenCalledWith(
        VALID_CLIENT.id,
        {
          grant: { projectId: 'prj_pinned', scopes: null },
          scope: ['read', 'write'],
          readOnly: false,
        },
      );
    });

    it('refuses to widen back to write when the client mandated read-only', async () => {
      const state = await buildSignedState({
        defaultReadOnly: true,
        requestedScope: ['read'],
      });
      await captureRedirect(() =>
        approveConsent(
          formData({
            signedState: state,
            categoriesAll: 'true',
            // User tries to flip back to full access.
            readonly: 'false',
          }),
        ),
      );

      expect(model.saveClientAuthContext).toHaveBeenCalledWith(
        VALID_CLIENT.id,
        {
          grant: { projectId: null, scopes: null },
          scope: ['read'],
          readOnly: true,
        },
      );
    });
  });

  describe('error redirects', () => {
    it('redirects to the error page when signedState is missing', async () => {
      const url = await captureRedirect(() =>
        approveConsent(formData({ readonly: 'false' })),
      );
      expect(url).toBe('/oauth/consent/error?reason=missing_state');
      expect(model.saveClientAuthContext).not.toHaveBeenCalled();
    });

    it('redirects to the error page when signedState is tampered', async () => {
      const state = await buildSignedState();
      const tampered = state.replace(/^[0-9a-f]/, '0');
      const url = await captureRedirect(() =>
        approveConsent(formData({ signedState: tampered, readonly: 'false' })),
      );
      expect(url).toBe('/oauth/consent/error?reason=invalid_state');
      expect(model.saveClientAuthContext).not.toHaveBeenCalled();
      expect(upstreamAuth).not.toHaveBeenCalled();
    });

    it('redirects to the error page when signedState is older than the TTL', async () => {
      const expiredIat = Date.now() - 31 * 60 * 1000; // 31 min — past 30 min TTL
      const state = await buildSignedState({ iat: expiredIat });
      const url = await captureRedirect(() =>
        approveConsent(formData({ signedState: state, readonly: 'false' })),
      );
      expect(url).toBe('/oauth/consent/error?reason=invalid_state');
    });

    it('redirects to the error page when the client is gone', async () => {
      vi.mocked(model.getClient).mockResolvedValue(undefined);
      const state = await buildSignedState();
      const url = await captureRedirect(() =>
        approveConsent(formData({ signedState: state, readonly: 'false' })),
      );
      expect(url).toBe('/oauth/consent/error?reason=invalid_client');
    });

    it('redirects to the error page when the redirect URI no longer matches the registered list', async () => {
      const state = await buildSignedState(
        {},
        {
          redirectUri: 'http://attacker.example/callback',
        },
      );
      const url = await captureRedirect(() =>
        approveConsent(formData({ signedState: state, readonly: 'false' })),
      );
      expect(url).toBe('/oauth/consent/error?reason=invalid_redirect');
      expect(upstreamAuth).not.toHaveBeenCalled();
    });
  });
});

describe('cancelConsent', () => {
  beforeEach(() => {
    redirectCalls.length = 0;
    vi.clearAllMocks();
    vi.mocked(model.getClient).mockResolvedValue(
      VALID_CLIENT as unknown as Awaited<ReturnType<typeof model.getClient>>,
    );
  });

  it("redirects to the client's redirect_uri with error=access_denied and the original state", async () => {
    const state = await buildSignedState(
      {},
      { state: 'preserved-state-value' },
    );
    const url = await captureRedirect(() =>
      cancelConsent(formData({ signedState: state })),
    );

    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      'http://127.0.0.1:55667/callback',
    );
    expect(parsed.searchParams.get('error')).toBe('access_denied');
    expect(parsed.searchParams.get('error_description')).toBe(
      'User denied the authorization request',
    );
    expect(parsed.searchParams.get('state')).toBe('preserved-state-value');
  });

  it('redirects to the error page when signedState is missing', async () => {
    const url = await captureRedirect(() => cancelConsent(formData({})));
    expect(url).toBe('/oauth/consent/error?reason=missing_state');
  });

  it('redirects to the error page when signedState is tampered', async () => {
    const state = await buildSignedState();
    const tampered = state.replace(/^[0-9a-f]/, '0');
    const url = await captureRedirect(() =>
      cancelConsent(formData({ signedState: tampered })),
    );
    expect(url).toBe('/oauth/consent/error?reason=invalid_state');
  });

  it('redirects to the error page when the redirect URI is no longer registered', async () => {
    const state = await buildSignedState(
      {},
      {
        redirectUri: 'http://attacker.example/callback',
      },
    );
    const url = await captureRedirect(() =>
      cancelConsent(formData({ signedState: state })),
    );
    expect(url).toBe('/oauth/consent/error?reason=invalid_redirect');
  });
});
