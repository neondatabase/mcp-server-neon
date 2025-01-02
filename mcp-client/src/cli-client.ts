import { StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';
import readline from 'readline/promises';
import { MCPClient } from './index.js';
import { consoleStyles, Logger } from './logger.js';

const EXIT_COMMAND = 'exit';

export class MCPClientCLI {
  private rl: readline.Interface;
  private client: MCPClient;
  private logger: Logger;

  constructor(serverConfig: StdioServerParameters) {
    this.client = new MCPClient(serverConfig);
    this.logger = new Logger({ mode: 'verbose' });

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  async start() {
    try {
      this.logger.log(consoleStyles.separator + '\n', { type: 'info' });
      this.logger.log('🤖 Interactive Claude CLI\n', { type: 'info' });
      this.logger.log(`Type your queries or "${EXIT_COMMAND}" to exit\n`, {
        type: 'info',
      });
      this.logger.log(consoleStyles.separator + '\n', { type: 'info' });
      this.client.start();

      await this.chat_loop();
    } catch (error) {
      this.logger.log('Failed to initialize tools: ' + error + '\n', {
        type: 'error',
      });
      process.exit(1);
    } finally {
      this.rl.close();
      process.exit(0);
    }
  }

  private async chat_loop() {
    while (true) {
      try {
        const query = (await this.rl.question(consoleStyles.prompt)).trim();
        if (query.toLowerCase() === EXIT_COMMAND) {
          this.logger.log('\nGoodbye! 👋\n', { type: 'warning' });
          break;
        }

        await this.client.processQuery(query);
        this.logger.log('\n' + consoleStyles.separator + '\n');
      } catch (error) {
        this.logger.log('\nError: ' + error + '\n', { type: 'error' });
      }
    }
  }
}
