import express, { Request, Response, RequestHandler } from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createMcpServer } from '../server/index.js';
import { createNeonClient } from '../server/api.js';
import { logger, morganConfig, errorHandler } from '../utils/logger.js';
import { authRouter } from '../oauth/server.js';
import {
  ensureCorsHeaders,
  extractBearerToken,
  requiresAuth,
} from '../oauth/utils.js';
import bodyParser from 'body-parser';

export const createSseTransport = async () => {
  const app = express();

  app.use(morganConfig);
  app.use(errorHandler);
  app.use(ensureCorsHeaders());
  app.use('/', authRouter);

  // to support multiple simultaneous connections we have a lookup object from
  // sessionId to transport
  const transports = new Map<string, SSEServerTransport>();

  app.get('/', (async (req: Request, res: Response) => {
    const access_token = extractBearerToken(
      req.headers.authorization as string,
    );
    const neonClient = createNeonClient(access_token);
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
      const access_token = extractBearerToken(
        req.headers.authorization as string,
      );
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

      const server = await createMcpServer(access_token);
      await server.connect(transport);
    },
  );

  app.post('/messages', bodyParser.raw(), (async (
    request: Request,
    response: Response,
  ) => {
    const sessionId = request.query.sessionId as string;
    const transport = transports.get(sessionId);
    logger.info('Received message', {
      sessionId,
      hasTransport: Boolean(transport),
    });

    if (transport) {
      await transport.handlePostMessage(request, response);
    } else {
      logger.warn('No transport found for sessionId', { sessionId });
      response.status(400).send('No transport found for sessionId');
    }
  }) as RequestHandler);

  try {
    app.listen({ port: 3001 });
    logger.info('Server started on port 3001');
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
};
