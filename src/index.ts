#!/usr/bin/env node

import { identify, initAnalytics, track } from './analytics/analytics.js';
import { NODE_ENV } from './constants.js';
import { handleInit, parseArgs } from './initConfig.js';
import { createNeonClient, getPackageJson } from './server/api.js';
import { createMcpServer } from './server/index.js';
import { createSseTransport } from './transports/sse-express.js';
import { startStdio } from './transports/stdio.js';
import { logger } from './utils/logger.js';
import { AppContext } from './types/context.js';
import { NEON_TOOLS } from './tools.js';
import './utils/polyfills.js';

const args = parseArgs();
const appVersion = getPackageJson().version;
const appName = getPackageJson().name;

if (args.command === 'export-tools') {
  console.log(
    JSON.stringify(
      NEON_TOOLS.map((item) => ({ ...item, inputSchema: undefined })),
      null,
      2,
    ),
  );
  process.exit(0);
}

const appContext: AppContext = {
  environment: NODE_ENV,
  name: appName,
  version: appVersion,
  transport: 'stdio',
};

if (args.analytics) {
  initAnalytics();
}

if (args.command === 'start:sse') {
  createSseTransport({
    ...appContext,
    transport: 'sse',
  });
} else {
  // Turn off logger in stdio mode to avoid capturing stderr in wrong format by host application (Claude Desktop)
  logger.silent = true;

  try {
    const neonClient = createNeonClient(args.neonApiKey);
    const { data: user } = await neonClient.getCurrentUserInfo();
    identify(user, {
      context: appContext,
    });

    if (args.command === 'init') {
      track({
        userId: user.id,
        event: 'init_stdio',
        context: appContext,
      });
      handleInit({
        executablePath: args.executablePath,
        neonApiKey: args.neonApiKey,
        analytics: args.analytics,
      });
      process.exit(0);
    }

    if (args.command === 'start') {
      track({
        userId: user.id,
        event: 'start_stdio',
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
      await startStdio(server);
    }
  } catch (error) {
    console.error('Server error:', error);
    track({
      anonymousId: 'anonymous',
      event: 'server_error',
      properties: { error },
      context: appContext,
    });
    process.exit(1);
  }
}
