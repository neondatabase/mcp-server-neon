import { MCPClientCLI } from './cli-client.js';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({
  path: path.resolve(__dirname, '../.env'),
});
const cli = new MCPClientCLI({
  command: path.resolve(__dirname, '../../landing/dist/cli/cli.js'),
  args: ['start', process.env.NEON_API_KEY!],
});

cli.start();
