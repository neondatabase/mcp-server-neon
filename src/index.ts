#!/usr/bin/env node

import { handleInit, parseArgs } from './initConfig.js';
import { createMcpServer } from './server/index.js';
import { startStdio } from './transports/stdio.js';
import './utils/polyfills.js';

const commands = ['init', 'start'] as const;
const { command, neonApiKey, executablePath } = parseArgs();
if (!commands.includes(command as (typeof commands)[number])) {
  console.error(`Invalid command: ${command}`);
  process.exit(1);
}
if (command === 'init') {
  // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression, @typescript-eslint/await-thenable
  await handleInit({
    executablePath,
    neonApiKey,
  });
  process.exit(0);
}

if (command === 'start') {
  try {
    const server = createMcpServer(neonApiKey);
    await startStdio(server);
  } catch (error) {
    console.error('Server error:', error);
    process.exit(1);
  }
}
