import './sentry/instrument';
import { identify, track } from './analytics/analytics';
import { NODE_ENV } from './constants';
import { handleInit, parseArgs } from './initConfig';
import { createNeonClient, getPackageJson } from './server/api';
import { createMcpServer } from './server/index';
import { startStdio } from './transports/stdio';
import { logger } from './utils/logger';
import { AppContext } from './types/context';
import { AuthContext } from './types/auth';
import { NEON_TOOLS } from './tools/index';
import './utils/polyfills';
import type { Api, AuthDetailsResponse } from '@neondatabase/api-client';

const args = parseArgs();
const appVersion = getPackageJson().version;
const appName = getPackageJson().name;

// Helper to identify API key user/org (inlined from old identifyApiKey)
const fetchAccountFromApiKey = async (
  auth: AuthDetailsResponse,
  neonClient: Api<unknown>,
  appContext: AppContext
): Promise<AuthContext['extra']['account']> => {
  if (auth.auth_method === 'api_key_org') {
    const { data: org } = await neonClient.getOrganization(auth.account_id);
    const account = { id: auth.account_id, name: org.name, isOrg: true };
    identify(account, { context: appContext });
    return account;
  }
  const { data: user } = await neonClient.getCurrentUserInfo();
  const account = {
    id: user.id,
    name: `${user.name} ${user.last_name}`.trim(),
    email: user.email,
    isOrg: false,
  };
  identify(account, { context: appContext });
  return account;
};

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


if (args.command === 'start:sse') {
  console.error(
    'SSE mode is not supported in CLI. Use the Vercel deployment for remote access.',
  );
  process.exit(1);
} else {
  // Turn off logger in stdio mode to avoid capturing stderr in wrong format by host application (Claude Desktop)
  logger.silent = true;

  try {
    const neonClient = createNeonClient(args.neonApiKey);
    const { data } = await neonClient.getAuthDetails();
    const accountId = data.account_id;

    const account = await fetchAccountFromApiKey(data, neonClient, appContext);

    if (args.command === 'init') {
      track({
        userId: accountId,
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
        userId: accountId,
        event: 'start_stdio',
        context: appContext,
      });
      const server = createMcpServer({
        apiKey: args.neonApiKey,
        account,
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
