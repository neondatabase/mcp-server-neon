import Fastify from 'fastify';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createMcpServer } from '../server/index.js';
import chalk from 'chalk';

export const createSseTransport = async () => {
  const fastify = Fastify({ logger: true });
  // to support multiple simultaneous connections we have a lookup object from
  // sessionId to transport
  const transports = new Map<string, SSEServerTransport>();

  fastify.get('/', () => ({ hello: 'world' }));
  fastify.get('/sse', async (request, reply) => {
    const transport = new SSEServerTransport('/messages', reply.raw);
    transports.set(transport.sessionId, transport);
    console.log(chalk.yellow('Connection Opened:'), transport.sessionId);
    const { authorization } = request.headers;
    if (!authorization) {
      console.log(chalk.red('Unauthorized Connection:'), transport.sessionId);
      reply.code(401).send('Unauthorized');
      return;
    }
    reply.raw.on('close', () => {
      console.log(chalk.yellow('Connection Closed:'), transport.sessionId);
      transports.delete(transport.sessionId);
    });
    const server = await createMcpServer(authorization);
    await server.connect(transport);
    console.log(chalk.yellow('Connection Completed:'), transport.sessionId);
  });

  type MessagesRequestParams = {
    sessionId: string;
  };

  fastify.post<{ Params: MessagesRequestParams }>(
    '/messages',
    async (req, reply) => {
      const sessionId = req.params.sessionId;
      const transport = transports.get(sessionId);
      if (transport) {
        await transport.handlePostMessage(req.raw, reply.raw);
      } else {
        reply.code(400).send('No transport found for sessionId');
      }
    },
  );

  try {
    await fastify.listen({ port: 3001 });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
