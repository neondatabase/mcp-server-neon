#!/usr/bin/env node

import { identify, initAnalytics, track } from './analytics/analytics.js';
import { IS_DEV } from './constants.js';
import { handleInit, parseArgs } from './initConfig.js';
import { createNeonClient, getPackageJson } from './server/api.js';
import { AppContext, createMcpServer } from './server/index.js';
import { createSseTransport } from './transports/sse-express.js';
import { startStdio } from './transports/stdio.js';
import { logger } from './utils/logger.js';
import './utils/polyfills.js';

const args = parseArgs();
const appVersion = getPackageJson().version;
const appName = getPackageJson().name;

if (args.command === 'init') {
  // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression, @typescript-eslint/await-thenable
  await handleInit({
    executablePath: args.executablePath,
    neonApiKey: args.neonApiKey,
  });
  process.exit(0);
}
const appContext: AppContext = {
  environment: IS_DEV ? 'development' : 'production',
  name: appName,
  version: appVersion,
  transport: 'stdio',
};

initAnalytics();
if (args.command === 'start:sse') {
  createSseTransport({
    ...appContext,
    transport: 'sse',
  });
}

if (args.command === 'start') {
  try {
    const neonClient = createNeonClient(args.neonApiKey);
    const { data: user } = await neonClient.getCurrentUserInfo();
    identify({
      userId: user.id,
      traits: {
        name: user.name,
        email: user.email,
      },
      context: appContext,
    });

    const server = createMcpServer({
      apiKey: args.neonApiKey,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      app: appContext,
    });
    // Turn off logger in stdio mode to avoid capturing stderr in wrong format by host application (Claude Desktop)
    logger.silent = true;
    await startStdio(server);
  } catch (error) {
    logger.error('Server error:', error);
    track({
      anonymousId: 'anonymous',
      event: 'server_error',
      properties: { error },
      context: appContext,
    });
    process.exit(1);
  }
}
