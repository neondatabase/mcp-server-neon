import '../sentry/instrument.js';
import { setupExpressErrorHandler } from '@sentry/node';
import express, { Request, Response, RequestHandler } from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createMcpServer } from '../server/index.js';
import { createNeonClient } from '../server/api.js';
import { logger, morganConfig, errorHandler } from '../utils/logger.js';
import { authRouter } from '../oauth/server.js';
import { SERVER_PORT, SERVER_HOST } from '../constants.js';
import { ensureCorsHeaders, requiresAuth } from '../oauth/utils.js';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import { track } from '../analytics/analytics.js';
import { AppContext } from '../types/context.js';

export const createSseTransport = (appContext: AppContext) => {
  const app = express();

  app.use(morganConfig);
  app.use(errorHandler);
  app.use(cookieParser());
  app.use(ensureCorsHeaders());
  app.use(express.static('public'));
  app.set('view engine', 'pug');
  app.set('views', 'src/views');
  app.use('/', authRouter);

  // to support multiple simultaneous connections we have a lookup object from
  // sessionId to transport
  const transports = new Map<string, SSEServerTransport>();

  app.get('/auth-check', (async (req: Request, res: Response) => {
    const auth = req.auth;
    if (!auth) {
      res.status(401).send('Unauthorized');
      return;
    }

    const neonClient = createNeonClient(auth.token);
    const user = await neonClient.getCurrentUserInfo();
    res.send({
      hello: `${user.data.name} ${user.data.last_name}`.trim(),
    });
  }) as RequestHandler);

  app.get(
    '/sse',
    bodyParser.raw(),
    requiresAuth(),
    async (req: Request, res: Response) => {
      const auth = req.auth;
      if (!auth) {
        res.status(401).send('Unauthorized');
        return;
      }
      const transport = new SSEServerTransport('/messages', res);
      transports.set(transport.sessionId, transport);
      logger.info('new sse connection', {
        sessionId: transport.sessionId,
      });

      res.on('close', () => {
        logger.info('SSE connection closed', {
          sessionId: transport.sessionId,
        });
        transports.delete(transport.sessionId);
      });

      try {
        const server = createMcpServer({
          apiKey: auth.token,
          client: auth.extra.client,
          user: auth.extra.user,
          app: appContext,
        });
        await server.connect(transport);
      } catch (error: unknown) {
        logger.error('Failed to connect to MCP server:', {
          message: error instanceof Error ? error.message : 'Unknown error',
          error,
        });
        track({
          userId: auth.extra.user.id,
          event: 'sse_connection_errored',
          properties: { error },
          context: {
            app: appContext,
            client: auth.extra.client,
          },
        });
      }
    },
  );

  app.post('/messages', bodyParser.raw(), requiresAuth(), (async (
    request: Request,
    response: Response,
  ) => {
    const auth = request.auth;
    if (!auth) {
      response.status(401).send('Unauthorized');
      return;
    }
    const sessionId = request.query.sessionId as string;
    const transport = transports.get(sessionId);
    logger.info('transport message received', {
      sessionId,
      hasTransport: Boolean(transport),
    });

    try {
      if (transport) {
        await transport.handlePostMessage(request, response);
      } else {
        logger.warn('No transport found for sessionId', { sessionId });
        response.status(400).send('No transport found for sessionId');
      }
    } catch (error: unknown) {
      logger.error('Failed to handle post message:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        error,
      });
      track({
        userId: auth.extra.user.id,
        event: 'transport_message_errored',
        properties: { error },
        context: { app: appContext, client: auth.extra.client },
      });
    }
  }) as RequestHandler);

  setupExpressErrorHandler(app);

  try {
    app.listen({ port: SERVER_PORT });
    logger.info(`Server started on ${SERVER_HOST}`);
  } catch (err: unknown) {
    logger.error('Failed to start server:', {
      error: err instanceof Error ? err.message : 'Unknown error',
    });
    process.exit(1);
  }
};
