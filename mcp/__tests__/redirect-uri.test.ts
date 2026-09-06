import { describe, expect, it } from 'vitest';
import { isAllowedDcrRedirectUri } from '../../lib/oauth/redirect-uri';

describe('isAllowedDcrRedirectUri', () => {
  it('allows loopback http redirects', () => {
    expect(isAllowedDcrRedirectUri('http://127.0.0.1:55555/callback')).toBe(
      true,
    );
    expect(isAllowedDcrRedirectUri('http://localhost:3000/oauth')).toBe(true);
    expect(isAllowedDcrRedirectUri('http://[::1]/callback')).toBe(true);
  });

  it('allows ChatGPT, Claude.ai, and Postman HTTPS hosts', () => {
    expect(
      isAllowedDcrRedirectUri(
        'https://chatgpt.com/connector/oauth/aF1iFlAFZjHP',
      ),
    ).toBe(true);
    expect(
      isAllowedDcrRedirectUri('https://claude.ai/api/mcp/auth_callback'),
    ).toBe(true);
    expect(
      isAllowedDcrRedirectUri('https://oauth.pstmn.io/v1/browser-callback'),
    ).toBe(true);
    expect(
      isAllowedDcrRedirectUri('https://chatgpt.com./connector/oauth/x'),
    ).toBe(true);
  });

  it('rejects attacker-controlled and malformed redirects', () => {
    expect(isAllowedDcrRedirectUri('https://evil.example/cb')).toBe(false);
    expect(isAllowedDcrRedirectUri('https://chatgpt.com.evil.example/cb')).toBe(
      false,
    );
    expect(isAllowedDcrRedirectUri('http://evil.example/cb')).toBe(false);
    expect(isAllowedDcrRedirectUri('https://localhost:3000/callback')).toBe(
      false,
    );
    expect(isAllowedDcrRedirectUri('javascript:alert(1)')).toBe(false);
    expect(isAllowedDcrRedirectUri('https://chatgpt.com/oauth#fragment')).toBe(
      false,
    );
    expect(isAllowedDcrRedirectUri('https://user:pass@chatgpt.com/oauth')).toBe(
      false,
    );
    expect(isAllowedDcrRedirectUri('not-a-url')).toBe(false);
  });
});
