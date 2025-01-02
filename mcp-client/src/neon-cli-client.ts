import { MCPClientCLI } from './cli-client.js';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({
  path: path.resolve(__dirname, '../.env'),
});
const cli = new MCPClientCLI({
  command: path.resolve(__dirname, '../../dist/index.js'), // Use __dirname for relative path
  args: ['start', process.env.NEON_API_KEY!],
});

cli.start();
