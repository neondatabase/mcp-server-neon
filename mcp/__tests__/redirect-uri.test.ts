import { describe, expect, it } from 'vitest';
import {
  admitDcrRedirectUris,
  isDangerousRedirectUri,
} from '../../lib/oauth/redirect-uri';

describe('admitDcrRedirectUris', () => {
  it('admits loopback http and any https host', () => {
    const uris = [
      'http://127.0.0.1:55555/callback',
      'http://localhost:3000/oauth',
      'http://[::1]/callback',
      'http://LOCALHOST./cb',
      'https://chatgpt.com/connector/oauth/x',
      'https://claude.ai/api/mcp/auth_callback',
      'https://oauth.pstmn.io/v1/browser-callback',
      'https://antigravity.google/oauth-callback',
      'https://gamma.app.kiro.dev/agent/mcp/callback',
      'https://backend.composio.dev/api/v1/auth-apps/add',
      'https://www.cursor.com/agents/mcp/oauth/callback',
      'https://localhost:3000/callback',
      'https://evil.example/cb',
    ];

    expect(admitDcrRedirectUris(uris)).toEqual({
      admitted: uris,
      rejected: [],
    });
  });

  it('rejects custom schemes, non-loopback http, userinfo, fragments, and garbage', () => {
    expect(
      admitDcrRedirectUris(['cursor://anysphere.cursor-mcp/oauth/callback']),
    ).toEqual({
      admitted: [],
      rejected: [
        {
          label: 'cursor://anysphere.cursor-mcp',
          reason: 'scheme_not_allowed',
        },
      ],
    });
    expect(admitDcrRedirectUris(['com.example.app:/callback'])).toEqual({
      admitted: [],
      rejected: [{ label: 'com.example.app:', reason: 'scheme_not_allowed' }],
    });
    expect(admitDcrRedirectUris(['javascript:alert(1)'])).toEqual({
      admitted: [],
      rejected: [{ label: 'javascript:', reason: 'scheme_not_allowed' }],
    });
    expect(admitDcrRedirectUris(['data:text/html,x'])).toEqual({
      admitted: [],
      rejected: [{ label: 'data:', reason: 'scheme_not_allowed' }],
    });
    expect(admitDcrRedirectUris(['file:///etc/passwd'])).toEqual({
      admitted: [],
      rejected: [{ label: 'file:', reason: 'scheme_not_allowed' }],
    });
    expect(admitDcrRedirectUris(['blob:https://x/y'])).toEqual({
      admitted: [],
      rejected: [{ label: 'blob:', reason: 'scheme_not_allowed' }],
    });
    expect(admitDcrRedirectUris(['http://evil.example/cb'])).toEqual({
      admitted: [],
      rejected: [{ label: 'http://evil.example', reason: 'http_not_loopback' }],
    });
    expect(admitDcrRedirectUris(['http://localhost.evil.example/cb'])).toEqual({
      admitted: [],
      rejected: [
        {
          label: 'http://localhost.evil.example',
          reason: 'http_not_loopback',
        },
      ],
    });
    expect(admitDcrRedirectUris(['https://user:pass@chatgpt.com/x'])).toEqual({
      admitted: [],
      rejected: [{ label: 'https://chatgpt.com', reason: 'has_userinfo' }],
    });
    expect(admitDcrRedirectUris(['https://a.b/c#frag'])).toEqual({
      admitted: [],
      rejected: [{ label: 'https://a.b', reason: 'has_fragment' }],
    });
    expect(admitDcrRedirectUris(['not-a-url'])).toEqual({
      admitted: [],
      rejected: [{ label: 'unparseable', reason: 'malformed' }],
    });
    expect(admitDcrRedirectUris([''])).toEqual({
      admitted: [],
      rejected: [{ label: 'unparseable', reason: 'malformed' }],
    });
  });

  it('drops cursor:// from a mixed Cursor payload and keeps input order', () => {
    expect(
      admitDcrRedirectUris([
        'http://localhost:51234/oauth/callback',
        'https://www.cursor.com/agents/mcp/oauth/callback',
        'cursor://anysphere.cursor-mcp/oauth/callback',
      ]),
    ).toEqual({
      admitted: [
        'http://localhost:51234/oauth/callback',
        'https://www.cursor.com/agents/mcp/oauth/callback',
      ],
      rejected: [
        {
          label: 'cursor://anysphere.cursor-mcp',
          reason: 'scheme_not_allowed',
        },
      ],
    });
  });
});

describe('isDangerousRedirectUri', () => {
  it('is true for schemes that must not be used as a browser redirect', () => {
    expect(isDangerousRedirectUri('javascript:alert(1)')).toBe(true);
    expect(isDangerousRedirectUri('data:text/html,x')).toBe(true);
    expect(isDangerousRedirectUri('file:///etc/passwd')).toBe(true);
    expect(isDangerousRedirectUri('blob:https://x/y')).toBe(true);
    expect(isDangerousRedirectUri('vbscript:alert(1)')).toBe(true);
    expect(isDangerousRedirectUri('about:blank')).toBe(true);
    expect(isDangerousRedirectUri('not-a-url')).toBe(true);
  });

  it('is false for custom schemes, non-loopback http, https, and loopback', () => {
    expect(
      isDangerousRedirectUri('cursor://anysphere.cursor-mcp/oauth/callback'),
    ).toBe(false);
    expect(isDangerousRedirectUri('http://evil.example/cb')).toBe(false);
    expect(isDangerousRedirectUri('https://a.b/c')).toBe(false);
    expect(isDangerousRedirectUri('http://localhost:1/cb')).toBe(false);
  });
});
