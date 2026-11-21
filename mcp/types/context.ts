import type { GrantContext } from '../utils/grant-context';
import { AuthContext } from './auth';

export type AppContext = {
  name: string;
  transport: 'stream';
  /** `NODE_ENV` as the process sees it, `production` when unset. */
  environment: string;
  version: string;
};

export type ServerContext = {
  apiKey: string;
  authMethod: AuthContext['extra']['authMethod'];
  client?: AuthContext['extra']['client'];
  account: AuthContext['extra']['account'];
  app: AppContext;
  readOnly?: AuthContext['extra']['readOnly'];
  userAgent?: string;
  grant?: GrantContext;
};
