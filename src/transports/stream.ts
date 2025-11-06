import { Request, Response, Router } from 'express';
import { AppContext } from '../types/context.js';
import { createMcpServer } from '../server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { logger } from '../utils/logger.js';
import { track } from '../analytics/analytics.js';
import { requiresAuth } from '../oauth/utils.js';

export const createStreamTransport = (appContext: AppContext) => {
  const router = Router();

  router.post('/', requiresAuth(), async (req: Request, res: Response) => {
    const auth = req.auth;
    if (!auth) {
      res.status(401).send('Unauthorized');
      return;
    }

    try {
      const server = createMcpServer({
        apiKey: auth.token,
        client: auth.extra.client,
        account: auth.extra.account,
        app: appContext,
        readOnly: auth.extra.readOnly as boolean | undefined,
      });

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error: unknown) {
      logger.error('Failed to connect to MCP server:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        error,
      });
      track({
        userId: auth.extra.account.id,
        event: 'stream_connection_errored',
        properties: { error },
        context: {
          app: appContext,
          client: auth.extra.client,
        },
      });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }
    }
  });

  router.get('/', requiresAuth(), (req: Request, res: Response) => {
    logger.info('Received GET MCP request');
    res.writeHead(405).end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Method not allowed.',
        },
        id: null,
      }),
    );
  });

  router.delete('/', requiresAuth(), (req: Request, res: Response) => {
    logger.info('Received DELETE MCP request');
    res.writeHead(405).end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Method not allowed.',
        },
        id: null,
      }),
    );
  });

  return router;
};
