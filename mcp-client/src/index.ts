import { Anthropic } from '@anthropic-ai/sdk';

import {
  StdioClientTransport,
  StdioServerParameters,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  ListToolsResultSchema,
  CallToolResultSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import chalk from 'chalk';
import { Tool } from '@anthropic-ai/sdk/resources/index.mjs';
import { Stream } from '@anthropic-ai/sdk/streaming.mjs';
import { consoleStyles, Logger, LoggerOptions } from './logger.js';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

type MCPClientOptions = StdioServerParameters & {
  loggerOptions?: LoggerOptions;
};

export class MCPClient {
  private anthropicClient: Anthropic;
  private messages: Message[] = [];
  private mcpClient: Client;
  private transport: StdioClientTransport;
  private tools: Tool[] = [];
  private logger: Logger;

  constructor({ loggerOptions, ...serverConfig }: MCPClientOptions) {
    this.anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    this.mcpClient = new Client(
      { name: 'cli-client', version: '1.0.0' },
      { capabilities: {} },
    );

    this.transport = new StdioClientTransport(serverConfig);
    this.logger = new Logger(loggerOptions ?? { mode: 'verbose' });
  }

  async start() {
    try {
      await this.mcpClient.connect(this.transport);
      await this.initMCPTools();
    } catch (error) {
      this.logger.log('Failed to initialize MCP Client: ' + error + '\n', {
        type: 'error',
      });
      process.exit(1);
    }
  }

  async stop() {
    await this.mcpClient.close();
  }

  private async initMCPTools() {
    const toolsResults = await this.mcpClient.request(
      { method: 'tools/list' },
      ListToolsResultSchema,
    );
    this.tools = toolsResults.tools.map(({ inputSchema, ...tool }) => ({
      ...tool,
      input_schema: inputSchema,
    }));
  }

  private formatToolCall(toolName: string, args: any): string {
    return (
      '\n' +
      consoleStyles.tool.bracket('[') +
      consoleStyles.tool.name(toolName) +
      consoleStyles.tool.bracket('] ') +
      consoleStyles.tool.args(JSON.stringify(args, null, 2)) +
      '\n'
    );
  }

  private formatJSON(json: string): string {
    return json
      .replace(/"([^"]+)":/g, chalk.blue('"$1":'))
      .replace(/: "([^"]+)"/g, ': ' + chalk.green('"$1"'));
  }

  private async processStream(
    stream: Stream<Anthropic.Messages.RawMessageStreamEvent>,
  ): Promise<void> {
    let currentMessage = '';
    let currentToolName = '';
    let currentToolInputString = '';

    this.logger.log(consoleStyles.assistant);
    for await (const chunk of stream) {
      switch (chunk.type) {
        case 'message_start':
        case 'content_block_stop':
          continue;

        case 'content_block_start':
          if (chunk.content_block?.type === 'tool_use') {
            currentToolName = chunk.content_block.name;
          }
          break;

        case 'content_block_delta':
          if (chunk.delta.type === 'text_delta') {
            this.logger.log(chunk.delta.text);
            currentMessage += chunk.delta.text;
          } else if (chunk.delta.type === 'input_json_delta') {
            if (currentToolName && chunk.delta.partial_json) {
              currentToolInputString += chunk.delta.partial_json;
            }
          }
          break;

        case 'message_delta':
          if (currentMessage) {
            this.messages.push({
              role: 'assistant',
              content: currentMessage,
            });
          }

          if (chunk.delta.stop_reason === 'tool_use') {
            const toolArgs = currentToolInputString
              ? JSON.parse(currentToolInputString)
              : {};

            this.logger.log(
              this.formatToolCall(currentToolName, toolArgs) + '\n',
            );
            const toolResult = await this.mcpClient.request(
              {
                method: 'tools/call',
                params: {
                  name: currentToolName,
                  arguments: toolArgs,
                },
              },
              CallToolResultSchema,
            );

            const formattedResult = this.formatJSON(
              JSON.stringify(toolResult.content.flatMap((c) => c.text)),
            );

            this.messages.push({
              role: 'user',
              content: formattedResult,
            });

            const nextStream = await this.anthropicClient.messages.create({
              messages: this.messages,
              model: 'claude-3-5-sonnet-20241022',
              max_tokens: 8192,
              tools: this.tools,
              stream: true,
            });
            await this.processStream(nextStream);
          }
          break;

        case 'message_stop':
          break;

        default:
          this.logger.log(`Unknown event type: ${JSON.stringify(chunk)}\n`, {
            type: 'warning',
          });
      }
    }
  }

  async processQuery(query: string) {
    try {
      this.messages.push({ role: 'user', content: query });

      const stream = await this.anthropicClient.messages.create({
        messages: this.messages,
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 8192,
        tools: this.tools,
        stream: true,
      });
      await this.processStream(stream);

      return this.messages;
    } catch (error) {
      this.logger.log('\nError during query processing: ' + error + '\n', {
        type: 'error',
      });
      if (error instanceof Error) {
        this.logger.log(
          consoleStyles.assistant +
            'I apologize, but I encountered an error: ' +
            error.message +
            '\n',
        );
      }
    }
  }
}
