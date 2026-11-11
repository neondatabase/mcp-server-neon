/**
 * `get_neon_auth_config` reports `logs_export` from the plugins response. The
 * Neon API is answered by a stubbed `fetch`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as z from 'zod';
import { createNeonClient } from '../server/api';
import { NEON_HANDLERS } from '../tools/tools';
import { stubFakeNeon } from './helpers/fake-neon';
import { jsonContent } from './helpers/tool-result';

const PROJECT_ID = 'example-project-123';
const BRANCH_ID = 'br-example-123';
const API_KEY = 'napi_test';

const PLUGINS = {
  organization: {
    enabled: true,
    organization_limit: 10,
    membership_limit: 100,
    creator_role: 'owner',
    send_invitation_email: false,
  },
  magic_link: { enabled: false, expires_in: 5, disable_sign_up: false },
  phone_number: { enabled: false, otp_expires_in: 300 },
};

const AUTH_RESPONSES: Record<string, unknown> = {
  '': {
    auth_provider: 'better_auth',
    auth_provider_project_id: 'ap1',
    branch_id: BRANCH_ID,
    db_name: 'neondb',
    created_at: '2026-01-01T00:00:00Z',
    owned_by: 'neon',
    jwks_url: 'https://jwks.example/',
    base_url: 'https://auth.example/',
  },
  '/domains': { domains: [] },
  '/allow_localhost': { allow_localhost: false },
  '/email_and_password': {
    enabled: true,
    email_verification_method: 'link',
    require_email_verification: false,
    auto_sign_in_after_verification: true,
    send_verification_email_on_sign_up: false,
    send_verification_email_on_sign_in: false,
    disable_sign_up: false,
    revoke_sessions_on_password_reset: false,
  },
  '/oauth_providers': { providers: [] },
  '/email_provider': { type: 'shared' },
  '/webhooks': { enabled: false, enabled_events: [], timeout_seconds: 5 },
};

function stubAuth(plugins: Response) {
  const authPath = `/projects/${PROJECT_ID}/branches/${BRANCH_ID}/auth`;
  stubFakeNeon({
    projectId: PROJECT_ID,
    branchId: BRANCH_ID,
    database: 'neondb',
    owner: 'neondb_owner',
    api: (method, path) => {
      if (method !== 'GET' || !path.startsWith(authPath)) return undefined;
      const suffix = path.slice(authPath.length);
      if (suffix === '/plugins') return plugins;
      return suffix in AUTH_RESPONSES
        ? Response.json(AUTH_RESPONSES[suffix])
        : undefined;
    },
  });
}

const configSchema = z.object({
  plugins: z.unknown(),
  logs_export: z.unknown(),
  _errors: z.record(z.string(), z.string()).optional(),
});

async function readConfig() {
  const result = await NEON_HANDLERS.get_neon_auth_config(
    { params: { project_id: PROJECT_ID, branch_id: BRANCH_ID } },
    createNeonClient(API_KEY),
    { clientApplication: 'unknown', apiKey: API_KEY },
  );
  expect(result.isError).not.toBe(true);
  return configSchema.parse(jsonContent(result));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('get_neon_auth_config logs_export', () => {
  it('is null when the plugins response omits it, on a project without logs export', async () => {
    stubAuth(Response.json(PLUGINS));

    const config = await readConfig();
    expect(config.logs_export).toBeNull();
    expect(config.plugins).toEqual(PLUGINS);
  });

  it('reports the plugins response value when the project has logs export', async () => {
    stubAuth(Response.json({ ...PLUGINS, logs_export: { enabled: true } }));

    const config = await readConfig();
    expect(config.logs_export).toEqual({ enabled: true });
    expect(config.plugins).toEqual(PLUGINS);
  });

  it('is null when the plugins read fails', async () => {
    stubAuth(Response.json({ message: 'forbidden' }, { status: 403 }));

    const config = await readConfig();
    expect(config.logs_export).toBeNull();
    expect(config.plugins).toBeNull();
    expect(config._errors).toHaveProperty('plugins');
  });
});
