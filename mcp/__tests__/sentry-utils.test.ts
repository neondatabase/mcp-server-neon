import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerContext } from '../types/context';

const sentrySpies = vi.hoisted(() => ({
  setTags: vi.fn(),
  setUser: vi.fn(),
}));

vi.mock('@sentry/node', () => ({
  setTags: sentrySpies.setTags,
  setUser: sentrySpies.setUser,
}));

const { agentSentryTags, setSentryTags } = await import('../sentry/utils');

const agent = {
  clientName: 'ChatGPT',
  clientApplication: 'chatgpt' as const,
};

function buildContext(overrides: Partial<ServerContext> = {}): ServerContext {
  return {
    apiKey: 'test-api-key',
    authMethod: 'api_key_user',
    account: {
      id: 'acc-1',
      name: 'Test',
      email: 'test@example.com',
    },
    app: {
      name: 'mcp-server-neon',
      transport: 'stream',
      environment: 'development',
      version: '1.0.0',
    },
    ...overrides,
  };
}

describe('agentSentryTags', () => {
  it('maps analytics client fields onto searchable Sentry tags', () => {
    expect(agentSentryTags(agent)).toEqual({
      'client.agent': 'ChatGPT',
      'client.application': 'chatgpt',
    });
  });
});

describe('setSentryTags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets identified-agent tags and keeps OAuth client tags separate', () => {
    setSentryTags(
      buildContext({
        client: { id: 'oauth-client-id', name: 'ChatGPT' },
      }),
      agent,
    );

    expect(sentrySpies.setUser).toHaveBeenCalledWith({ id: 'acc-1' });
    expect(sentrySpies.setTags).toHaveBeenCalledWith(
      expect.objectContaining({
        'app.name': 'mcp-server-neon',
        'client.agent': 'ChatGPT',
        'client.application': 'chatgpt',
      }),
    );
    expect(sentrySpies.setTags).toHaveBeenCalledWith({
      'client.id': 'oauth-client-id',
      'client.name': 'ChatGPT',
    });
  });

  it('omits OAuth client tags when the request has no OAuth client', () => {
    setSentryTags(buildContext(), agent);

    expect(sentrySpies.setTags).toHaveBeenCalledTimes(1);
    expect(sentrySpies.setTags).toHaveBeenCalledWith(
      expect.not.objectContaining({
        'client.id': expect.anything(),
        'client.name': expect.anything(),
      }),
    );
  });
});
