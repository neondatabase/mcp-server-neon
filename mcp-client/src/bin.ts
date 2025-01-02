#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { MCPClientCLI } from './cli-client.js';

function checkRequiredEnvVars() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      '\x1b[31mError: ANTHROPIC_API_KEY environment variable is required\x1b[0m',
    );
    console.error('Please set it before running the CLI:');
    console.error('  export ANTHROPIC_API_KEY=your_key_here');
    process.exit(1);
  }
}

async function main() {
  try {
    checkRequiredEnvVars();

    const args = parseArgs({
      options: {
        'server-command': { type: 'string' },
        'server-args': { type: 'string' },
      },
      allowPositionals: true,
    });

    const serverCommand = args.values['server-command'];
    const serverArgs = args.values['server-args']?.split(' ') || [];

    if (!serverCommand) {
      console.error('Error: --server-command is required');
      process.exit(1);
    }

    const cli = new MCPClientCLI({
      command: serverCommand,
      args: serverArgs,
    });

    await cli.start();
  } catch (error) {
    console.error('Failed to start CLI:', error);
    process.exit(1);
  }
}

main();
