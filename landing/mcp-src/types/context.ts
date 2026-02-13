import { Environment } from '../constants';
import { AuthContext } from './auth';

export type AppContext = {
  name: string;
  transport: 'sse' | 'stream';
  environment: Environment;
  version: string;
};

export type ServerContext = {
  apiKey: string;
  client?: AuthContext['extra']['client'];
  account: AuthContext['extra']['account'];
  app: AppContext;
  readOnly?: AuthContext['extra']['readOnly'];
  userAgent?: string;
};
