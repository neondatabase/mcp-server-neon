import { describe, expect, it } from 'vitest';
import { isWellFormedOrigin } from '../../lib/origin';

describe('isWellFormedOrigin', () => {
  it.each([
    'https://claude.ai',
    'https://mcp.neon.tech',
    'http://localhost:6274',
    'http://127.0.0.1:8080',
    'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
    'moz-extension://12345678-1234-1234-1234-123456789abc',
    'tauri://localhost',
    'null',
  ])('accepts %s', (origin) => {
    expect(isWellFormedOrigin(origin)).toBe(true);
  });

  it.each([
    'attacker.example',
    'https://client.example/path',
    'https://client.example/',
    'javascript:alert(1)',
    'https://client.example?x=1',
    'https://client example',
    '',
  ])('rejects %j', (origin) => {
    expect(isWellFormedOrigin(origin)).toBe(false);
  });
});
