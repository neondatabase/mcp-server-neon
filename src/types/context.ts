import { Environment } from '../constants.js';
import { AuthContext } from './auth.js';

export type AppContext = {
  name: string;
  transport: 'sse' | 'stdio';
  environment: Environment;
  version: string;
};

export type ServerContext = {
  apiKey: string;
  client?: AuthContext['extra']['client'];
  user: AuthContext['extra']['user'];
  app: AppContext;
};
