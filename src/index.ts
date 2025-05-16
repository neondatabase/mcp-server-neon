#!/usr/bin/env node

import { handleInit, parseArgs } from './initConfig.js';
import { createMcpServer } from './server/index.js';
import { createSseTransport } from './transports/sse-express.js';
import { startStdio } from './transports/stdio.js';
import { logger } from './utils/logger.js';
import './utils/polyfills.js';

const args = parseArgs();

if (args.command === 'init') {
  // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression, @typescript-eslint/await-thenable
  await handleInit({
    executablePath: args.executablePath,
    neonApiKey: args.neonApiKey,
  });
  process.exit(0);
}

if (args.command === 'start:sse') {
  createSseTransport();
}

if (args.command === 'start') {
  try {
    const server = createMcpServer(args.neonApiKey);
    // Turn off logger in stdio mode to avoid capturing stderr in wrong format by host application (Claude Desktop)
    logger.silent = true;
    await startStdio(server);
  } catch (error) {
    logger.error('Server error:', error);
    process.exit(1);
  }
}
