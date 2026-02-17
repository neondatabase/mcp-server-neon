import { Environment } from '../constants';
import type { GrantContext } from '../utils/grant-context';
import { AuthContext } from './auth';

export type AppContext = {
  name: string;
  transport: 'sse' | 'stdio' | 'stream';
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
  grant?: GrantContext;
};
