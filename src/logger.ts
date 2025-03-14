import fs from 'fs';
import path from 'path';
import os from 'os';

const logFile = path.join(os.homedir(), 'mcp-server.log');

export const logger = {
  log: (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp} - ${message} ${data ? JSON.stringify(data, null, 2) : ''}\n`;
    fs.appendFileSync(logFile, logMessage);
  },
  error: (message: string, error?: any) => {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp} - ERROR: ${message} ${error ? JSON.stringify(error, null, 2) : ''}\n`;
    fs.appendFileSync(logFile, logMessage);
  }
}; 