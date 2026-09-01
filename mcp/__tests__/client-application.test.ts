import { describe, expect, it } from 'vitest';
import {
  detectClientApplication,
  identifyClient,
} from '../utils/client-application';

describe('detectClientApplication', () => {
  it.each([
    ['Cursor', 'cursor'],
    ['Cursor (via mcp-remote 0.1.31)', 'cursor'],
    ['claude-code', 'claude-code'],
    ['claude-user', 'claude-desktop'],
    ['Claude Desktop', 'claude-desktop'],
    ['ChatGPT', 'chatgpt'],
    ['chatgpt', 'chatgpt'],
    ['v0bot', 'v0'],
    ['Visual Studio Code', 'vscode'],
    ['MCP CLI Proxy', 'unknown'],
    ['', 'unknown'],
    [undefined, 'unknown'],
  ] as const)('%s → %s', (input, expected) => {
    expect(detectClientApplication(input)).toBe(expected);
  });
});

describe('identifyClient', () => {
  it('defaults missing names to unknown', () => {
    expect(identifyClient()).toEqual({
      clientName: 'unknown',
      clientApplication: 'unknown',
    });
  });

  it('keeps the handshake or UA string and classifies it', () => {
    expect(identifyClient('ChatGPT')).toEqual({
      clientName: 'ChatGPT',
      clientApplication: 'chatgpt',
    });
  });
});
