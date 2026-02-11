/**
 * Tests for CLI argument parsing in initConfig.ts.
 *
 * parseArgs reads process.argv directly and calls process.exit on invalid
 * input, so we mock process.exit and control process.argv per test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const originalArgv = process.argv;
const originalExit = process.exit;

describe('parseArgs', () => {
  beforeEach(() => {
    process.exit = vi.fn() as never;
    vi.mock('../utils/logger', () => ({
      logger: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      },
    }));
  });

  afterEach(() => {
    process.exit = originalExit;
    process.argv = originalArgv;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('parses "start <key>" command', async () => {
    process.argv = ['node', 'cli.js', 'start', 'napi_test_key'];
    const { parseArgs } = await import('../initConfig');
    const result = parseArgs();
    expect(result.command).toBe('start');
    if (result.command === 'start') {
      expect(result.neonApiKey).toBe('napi_test_key');
      expect(result.analytics).toBe(true);
    }
  });

  it('parses "start <key> --no-analytics"', async () => {
    process.argv = ['node', 'cli.js', 'start', 'napi_key', '--no-analytics'];
    const { parseArgs } = await import('../initConfig');
    const result = parseArgs();
    expect(result.command).toBe('start');
    if (result.command === 'start') {
      expect(result.neonApiKey).toBe('napi_key');
      expect(result.analytics).toBe(false);
    }
  });

  it('parses "export-tools" command', async () => {
    process.argv = ['node', 'cli.js', 'export-tools'];
    const { parseArgs } = await import('../initConfig');
    const result = parseArgs();
    expect(result).toEqual({ command: 'export-tools' });
  });

  it('parses "start:sse" command', async () => {
    process.argv = ['node', 'cli.js', 'start:sse'];
    const { parseArgs } = await import('../initConfig');
    const result = parseArgs();
    expect(result).toEqual({ command: 'start:sse', analytics: true });
  });

  it('calls process.exit for missing arguments', async () => {
    process.argv = ['node', 'cli.js'];
    const { parseArgs } = await import('../initConfig');
    parseArgs();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('calls process.exit for invalid command', async () => {
    process.argv = ['node', 'cli.js', 'invalid-cmd'];
    const { parseArgs } = await import('../initConfig');
    parseArgs();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('calls process.exit for start without API key', async () => {
    process.argv = ['node', 'cli.js', 'start'];
    const { parseArgs } = await import('../initConfig');
    parseArgs();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('parses "init <key>" with executable path', async () => {
    process.argv = ['node', 'cli.js', 'init', 'napi_key'];
    const { parseArgs } = await import('../initConfig');
    const result = parseArgs();
    expect(result.command).toBe('init');
    if (result.command === 'init') {
      expect(result.neonApiKey).toBe('napi_key');
      expect(result.executablePath).toBe('cli.js');
    }
  });
});
