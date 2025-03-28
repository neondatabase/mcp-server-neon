import express, { Request, Response } from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createMcpServer } from '../server/index.js';
import chalk from 'chalk';
import { auth } from 'express-openid-connect';
import { createApiClient } from '@neondatabase/api-client';
import { createNeonClient } from '../server/api.js';

export const createSseTransport = async () => {
  const app = express();

  app.use(
    auth({
      issuerBaseURL: 'http://localhost:4444',
      baseURL: 'http://localhost:3001',
      clientID: 'localmcp',
      clientSecret: 'hHYM19wY5FdV137DdiDf3Cti0K',
      secret: 'hHYM19wY5FdV137DdiDf3Cti0K',
      authorizationParams: {
        scope: [
          'openid',
          'offline',
          'offline_access',
          'urn:neoncloud:projects:read',
        ].join(' '),
        response_type: 'code',
      },
    }),
  );

  // to support multiple simultaneous connections we have a lookup object from
  // sessionId to transport
  const transports = new Map<string, SSEServerTransport>();

  app.get('/', async (request: Request, response: Response) => {
    if (!request.oidc.isAuthenticated() || !request.oidc.accessToken) {
      console.log(chalk.red('Unauthorized Connection:'));
      response.status(401).send('Unauthorized');
      return;
    }
    const { access_token } = request.oidc.accessToken;
    const neonClient = createNeonClient(access_token);
    const user = await neonClient.getCurrentUserInfo();
    response.send({
      hello: `${user.data.name} ${user.data.last_name}`.trim(),
    });
  });
  app.get('/sse', async (request: Request, response: Response) => {
    if (!request.oidc.isAuthenticated() || !request.oidc.accessToken) {
      console.log(chalk.red('Unauthorized Connection:'));
      response.status(401).send('Unauthorized');
      return;
    }
    const { access_token } = request.oidc.accessToken;
    const transport = new SSEServerTransport('/messages', response);
    transports.set(transport.sessionId, transport);
    response.on('close', () => {
      console.log(chalk.yellow('Connection Closed:'), transport.sessionId);
      transports.delete(transport.sessionId);
    });
    const server = await createMcpServer(access_token);
    await server.connect(transport);
  });

  app.post('/messages', async (request: Request, response: Response) => {
    const sessionId = request.query.sessionId as string;
    const transport = transports.get(sessionId);
    console.log(chalk.yellow('New messages:'), sessionId, Boolean(transport));
    if (transport) {
      await transport.handlePostMessage(request, response);
    } else {
      response.status(400).send('No transport found for sessionId');
    }
  });

  try {
    app.listen({ port: 3001 });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};
