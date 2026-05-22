import { describe, it, expect } from 'vitest';
import {
  neonAuthConfigGetInputSchema,
  neonAuthProvisionInputSchema,
  neonAuthSignInMethodsUpdateInputSchema,
  neonAuthEmailDeliveryUpdateInputSchema,
  neonAuthOrganizationsUpdateInputSchema,
  neonAuthAppUpdateInputSchema,
  neonAuthOauthProviderAddInputSchema,
  neonAuthOauthProviderUpdateInputSchema,
  neonAuthOauthProviderDeleteInputSchema,
  neonAuthDomainUpdateInputSchema,
  neonAuthWebhookUpdateInputSchema,
  neonAuthSendTestEmailInputSchema,
} from '../tools/toolsSchema';

// =============================================================================
// neon_auth_provision
// =============================================================================
describe('neonAuthProvisionInputSchema', () => {
  it('requires projectId', () => {
    expect(neonAuthProvisionInputSchema.safeParse({}).success).toBe(false);
  });

  it('accepts projectId only', () => {
    expect(
      neonAuthProvisionInputSchema.safeParse({ projectId: 'p1' }).success,
    ).toBe(true);
  });

  it('accepts projectId + branchId + databaseName', () => {
    expect(
      neonAuthProvisionInputSchema.safeParse({
        projectId: 'p1',
        branchId: 'b1',
        databaseName: 'neondb',
      }).success,
    ).toBe(true);
  });
});

// =============================================================================
// neon_auth_config_get
// =============================================================================
describe('neonAuthConfigGetInputSchema', () => {
  it('requires projectId', () => {
    expect(neonAuthConfigGetInputSchema.safeParse({}).success).toBe(false);
  });

  it('accepts projectId with optional branchId', () => {
    expect(
      neonAuthConfigGetInputSchema.safeParse({
        projectId: 'p1',
        branchId: 'b1',
      }).success,
    ).toBe(true);
  });
});

// =============================================================================
// neon_auth_sign_in_methods_update
// =============================================================================
describe('neonAuthSignInMethodsUpdateInputSchema', () => {
  it('rejects empty (no method slices)', () => {
    expect(
      neonAuthSignInMethodsUpdateInputSchema.safeParse({ projectId: 'p1' })
        .success,
    ).toBe(false);
  });

  it('accepts email_password partial', () => {
    expect(
      neonAuthSignInMethodsUpdateInputSchema.safeParse({
        projectId: 'p1',
        email_password: { enabled: true },
      }).success,
    ).toBe(true);
  });

  it('accepts magic_link toggle', () => {
    expect(
      neonAuthSignInMethodsUpdateInputSchema.safeParse({
        projectId: 'p1',
        magic_link: { enabled: true },
      }).success,
    ).toBe(true);
  });

  it('accepts phone toggle', () => {
    expect(
      neonAuthSignInMethodsUpdateInputSchema.safeParse({
        projectId: 'p1',
        phone: { enabled: false },
      }).success,
    ).toBe(true);
  });

  it('rejects email_password block with no fields', () => {
    expect(
      neonAuthSignInMethodsUpdateInputSchema.safeParse({
        projectId: 'p1',
        email_password: {},
      }).success,
    ).toBe(false);
  });

  it('rejects non-method config slices', () => {
    expect(
      neonAuthSignInMethodsUpdateInputSchema.safeParse({
        projectId: 'p1',
        app_name: 'My App',
      }).success,
    ).toBe(false);
  });
});

// =============================================================================
// neon_auth_email_delivery_update
// =============================================================================
describe('neonAuthEmailDeliveryUpdateInputSchema', () => {
  it('accepts type=shared with no overrides', () => {
    expect(
      neonAuthEmailDeliveryUpdateInputSchema.safeParse({
        projectId: 'p1',
        email_delivery: { type: 'shared' },
      }).success,
    ).toBe(true);
  });

  it('accepts type=standard with full SMTP', () => {
    expect(
      neonAuthEmailDeliveryUpdateInputSchema.safeParse({
        projectId: 'p1',
        email_delivery: {
          type: 'standard',
          host: 'smtp.example.com',
          port: 587,
          username: 'apikey',
          password: 'secret',
          sender_email: 'a@b.co',
          sender_name: 'Acme',
        },
      }).success,
    ).toBe(true);
  });

  it('rejects type=standard with missing fields', () => {
    expect(
      neonAuthEmailDeliveryUpdateInputSchema.safeParse({
        projectId: 'p1',
        email_delivery: { type: 'standard', host: 'h' },
      }).success,
    ).toBe(false);
  });

  it('rejects unknown discriminator type', () => {
    expect(
      neonAuthEmailDeliveryUpdateInputSchema.safeParse({
        projectId: 'p1',
        email_delivery: { type: 'sendgrid' },
      }).success,
    ).toBe(false);
  });
});

// =============================================================================
// neon_auth_organizations_update
// =============================================================================
describe('neonAuthOrganizationsUpdateInputSchema', () => {
  it('accepts enabled', () => {
    expect(
      neonAuthOrganizationsUpdateInputSchema.safeParse({
        projectId: 'p1',
        organizations: { enabled: true },
      }).success,
    ).toBe(true);
  });

  it('rejects empty organizations object', () => {
    expect(
      neonAuthOrganizationsUpdateInputSchema.safeParse({
        projectId: 'p1',
        organizations: {},
      }).success,
    ).toBe(false);
  });
});

// =============================================================================
// neon_auth_app_update
// =============================================================================
describe('neonAuthAppUpdateInputSchema', () => {
  it('accepts app_name', () => {
    expect(
      neonAuthAppUpdateInputSchema.safeParse({
        projectId: 'p1',
        app_name: 'My App',
      }).success,
    ).toBe(true);
  });

  it('rejects blank app_name', () => {
    expect(
      neonAuthAppUpdateInputSchema.safeParse({
        projectId: 'p1',
        app_name: '',
      }).success,
    ).toBe(false);
  });
});

// =============================================================================
// neon_auth_oauth_provider_add
// =============================================================================
describe('neonAuthOauthProviderAddInputSchema', () => {
  it('rejects without provider_id', () => {
    expect(
      neonAuthOauthProviderAddInputSchema.safeParse({ projectId: 'p1' })
        .success,
    ).toBe(false);
  });

  it('rejects unknown provider_id', () => {
    expect(
      neonAuthOauthProviderAddInputSchema.safeParse({
        projectId: 'p1',
        provider_id: 'twitter',
      }).success,
    ).toBe(false);
  });

  it('accepts provider_id alone (shared mode)', () => {
    expect(
      neonAuthOauthProviderAddInputSchema.safeParse({
        projectId: 'p1',
        provider_id: 'google',
      }).success,
    ).toBe(true);
  });

  it('accepts BYO mode with id+secret pair', () => {
    expect(
      neonAuthOauthProviderAddInputSchema.safeParse({
        projectId: 'p1',
        provider_id: 'github',
        oauth_provider_config: { client_id: 'a', client_secret: 'b' },
      }).success,
    ).toBe(true);
  });

  it('rejects half-set credentials (only client_id)', () => {
    expect(
      neonAuthOauthProviderAddInputSchema.safeParse({
        projectId: 'p1',
        provider_id: 'github',
        oauth_provider_config: { client_id: 'a' },
      }).success,
    ).toBe(false);
  });

  it('rejects half-set credentials (only client_secret)', () => {
    expect(
      neonAuthOauthProviderAddInputSchema.safeParse({
        projectId: 'p1',
        provider_id: 'github',
        oauth_provider_config: { client_secret: 'b' },
      }).success,
    ).toBe(false);
  });
});

// =============================================================================
// neon_auth_oauth_provider_update
// =============================================================================
describe('neonAuthOauthProviderUpdateInputSchema', () => {
  it('rejects empty config', () => {
    expect(
      neonAuthOauthProviderUpdateInputSchema.safeParse({
        projectId: 'p1',
        provider_id: 'google',
        oauth_provider_config: {},
      }).success,
    ).toBe(false);
  });

  it('rejects when oauth_provider_config is missing', () => {
    expect(
      neonAuthOauthProviderUpdateInputSchema.safeParse({
        projectId: 'p1',
        provider_id: 'google',
      }).success,
    ).toBe(false);
  });

  it('rejects microsoft (BetterAuth-only surface)', () => {
    const r = neonAuthOauthProviderUpdateInputSchema.safeParse({
      projectId: 'p1',
      provider_id: 'microsoft',
      oauth_provider_config: { client_id: 'x' },
    });
    expect(r.success).toBe(false);
  });
});

// =============================================================================
// neon_auth_oauth_provider_delete
// =============================================================================
describe('neonAuthOauthProviderDeleteInputSchema', () => {
  it('requires provider_id', () => {
    expect(
      neonAuthOauthProviderDeleteInputSchema.safeParse({ projectId: 'p1' })
        .success,
    ).toBe(false);
  });

  it('accepts valid provider_id', () => {
    expect(
      neonAuthOauthProviderDeleteInputSchema.safeParse({
        projectId: 'p1',
        provider_id: 'vercel',
      }).success,
    ).toBe(true);
  });
});

// =============================================================================
// neon_auth_domain_update — URL validation + at-least-one-field
// =============================================================================
describe('neonAuthDomainUpdateInputSchema', () => {
  it('rejects empty (no add/remove/allow_localhost)', () => {
    expect(
      neonAuthDomainUpdateInputSchema.safeParse({ projectId: 'p1' }).success,
    ).toBe(false);
  });

  it('accepts allow_localhost alone', () => {
    expect(
      neonAuthDomainUpdateInputSchema.safeParse({
        projectId: 'p1',
        allow_localhost: true,
      }).success,
    ).toBe(true);
  });

  it.each([
    ['https URL', 'https://app.example.com'],
    ['http localhost', 'http://localhost:3000'],
    ['custom scheme', 'myapp://'],
    ['subdomain wildcard', 'https://*.example.com'],
  ])('accepts add with %s (%s)', (_label, url) => {
    expect(
      neonAuthDomainUpdateInputSchema.safeParse({
        projectId: 'p1',
        add: [url],
      }).success,
    ).toBe(true);
  });

  it.each([
    ['plain string', 'not-a-url'],
    ['no scheme', 'example.com'],
    ['file scheme', 'file:///etc/passwd'],
    ['javascript scheme', 'javascript://example.com'],
    ['non-localhost http', 'http://example.com'],
    ['host-only wildcard', 'https://*'],
    ['TLD-only wildcard', 'https://*.com'],
    ['empty host', 'https://'],
  ])('rejects add with bad URL %s (%s)', (_label, url) => {
    expect(
      neonAuthDomainUpdateInputSchema.safeParse({
        projectId: 'p1',
        add: [url],
      }).success,
    ).toBe(false);
  });

  it('accepts add+remove+allow_localhost together', () => {
    expect(
      neonAuthDomainUpdateInputSchema.safeParse({
        projectId: 'p1',
        add: ['https://a.com'],
        remove: ['https://b.com'],
        allow_localhost: false,
      }).success,
    ).toBe(true);
  });
});

// =============================================================================
// neon_auth_webhook_update
// =============================================================================
describe('neonAuthWebhookUpdateInputSchema', () => {
  it('requires enabled', () => {
    expect(
      neonAuthWebhookUpdateInputSchema.safeParse({ projectId: 'p1' }).success,
    ).toBe(false);
  });

  it('accepts enabled=false alone (disable without clobbering url/events)', () => {
    expect(
      neonAuthWebhookUpdateInputSchema.safeParse({
        projectId: 'p1',
        enabled: false,
      }).success,
    ).toBe(true);
  });

  it('rejects enabled=true without url/events (PUT semantics would clobber)', () => {
    const r = neonAuthWebhookUpdateInputSchema.safeParse({
      projectId: 'p1',
      enabled: true,
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown event in events list', () => {
    expect(
      neonAuthWebhookUpdateInputSchema.safeParse({
        projectId: 'p1',
        enabled: true,
        url: 'https://hooks.example.com/neon',
        events: ['user.deleted'],
      }).success,
    ).toBe(false);
  });

  it('rejects timeout out of range', () => {
    expect(
      neonAuthWebhookUpdateInputSchema.safeParse({
        projectId: 'p1',
        enabled: true,
        url: 'https://hooks.example.com/neon',
        events: ['user.created'],
        timeout_seconds: 30,
      }).success,
    ).toBe(false);
  });

  it('rejects http:// webhook url (SSRF guard)', () => {
    expect(
      neonAuthWebhookUpdateInputSchema.safeParse({
        projectId: 'p1',
        enabled: true,
        url: 'http://hooks.example.com/neon',
        events: ['user.created'],
      }).success,
    ).toBe(false);
  });

  it('rejects loopback https webhook url (SSRF guard)', () => {
    expect(
      neonAuthWebhookUpdateInputSchema.safeParse({
        projectId: 'p1',
        enabled: true,
        url: 'https://127.0.0.1/neon',
        events: ['user.created'],
      }).success,
    ).toBe(false);
  });

  it('rejects link-local metadata webhook url (SSRF guard)', () => {
    expect(
      neonAuthWebhookUpdateInputSchema.safeParse({
        projectId: 'p1',
        enabled: true,
        url: 'https://169.254.169.254/latest/meta-data/',
        events: ['user.created'],
      }).success,
    ).toBe(false);
  });

  it('accepts a full config', () => {
    expect(
      neonAuthWebhookUpdateInputSchema.safeParse({
        projectId: 'p1',
        enabled: true,
        url: 'https://hooks.example.com/neon',
        events: ['user.created', 'send.magic_link'],
        timeout_seconds: 5,
      }).success,
    ).toBe(true);
  });
});

// =============================================================================
// neon_auth_send_test_email
// =============================================================================
describe('neonAuthSendTestEmailInputSchema', () => {
  it('requires recipient_email plus full SMTP', () => {
    expect(
      neonAuthSendTestEmailInputSchema.safeParse({ projectId: 'p1' }).success,
    ).toBe(false);
  });

  it('rejects invalid recipient email', () => {
    expect(
      neonAuthSendTestEmailInputSchema.safeParse({
        projectId: 'p1',
        recipient_email: 'not-an-email',
        host: 'smtp.example.com',
        port: 587,
        username: 'u',
        password: 'p',
        sender_email: 'a@b.co',
        sender_name: 'Acme',
      }).success,
    ).toBe(false);
  });

  it('accepts valid full payload', () => {
    expect(
      neonAuthSendTestEmailInputSchema.safeParse({
        projectId: 'p1',
        recipient_email: 'me@example.com',
        host: 'smtp.example.com',
        port: 587,
        username: 'u',
        password: 'p',
        sender_email: 'a@b.co',
        sender_name: 'Acme',
      }).success,
    ).toBe(true);
  });
});
