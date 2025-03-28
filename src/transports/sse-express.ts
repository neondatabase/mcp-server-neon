import express, { Request, Response } from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createMcpServer } from '../server/index.js';
import chalk from 'chalk';

export const createSseTransport = async () => {
  const app = express();

  // to support multiple simultaneous connections we have a lookup object from
  // sessionId to transport
  const transports = new Map<string, SSEServerTransport>();

  app.get('/', (_, response) => {
    response.send({ hello: 'World' });
  });
  app.get('/sse', async (request: Request, response: Response) => {
    const transport = new SSEServerTransport('/messages', response);
    transports.set(transport.sessionId, transport);
    console.log(chalk.yellow('Connection Opened:'), transport.sessionId);
    const { authorization } = request.headers;
    if (!authorization) {
      console.log(chalk.red('Unauthorized Connection:'), transport.sessionId);
      response.status(401).send('Unauthorized');
      return;
    }
    response.on('close', () => {
      console.log(chalk.yellow('Connection Closed:'), transport.sessionId);
      transports.delete(transport.sessionId);
    });
    const server = await createMcpServer(authorization);
    await server.connect(transport);
    console.log(chalk.yellow('Connection Completed:'), transport.sessionId);
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
    await app.listen({ port: 3001 });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};
