#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { log } from 'console';
import { NEON_HANDLERS, NEON_TOOLS } from './tools.js';
import { isNeonToolName } from './utils.js';
import { createApiClient } from '@neondatabase/api-client';
import { initClaudeConfig } from './initConfig.js';
const args = process.argv.slice(2);
if (args.length === 0) {
    console.error('Please provide a NEON_API_KEY as a command-line argument - you can get one through the Neon console: https://neon.tech/docs/manage/api-keys#create-an-api-key');
    process.exit(1);
}
const { neonApiKey } = await initClaudeConfig();
export const neonClient = createApiClient({
    apiKey: neonApiKey,
});
const server = new Server({
    name: 'mcp-server-neon',
    version: '0.1.0',
}, {
    capabilities: {
        tools: {},
    },
});
// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
    log('Received list tools request');
    return { tools: NEON_TOOLS };
});
// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    log('Received tool call:', toolName);
    try {
        if (isNeonToolName(toolName)) {
            return await NEON_HANDLERS[toolName](request);
        }
        throw new Error(`Unknown tool: ${toolName}`);
    }
    catch (error) {
        log('Error handling tool call:', error);
        return {
            toolResult: {
                content: [
                    {
                        type: 'text',
                        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            },
        };
    }
});
/**
 * Start the server using stdio transport.
 * This allows the server to communicate via standard input/output streams.
 */
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
});
