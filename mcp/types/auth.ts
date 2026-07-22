import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { AuthDetailsResponse } from '../neon-client';

export type AuthMethod = AuthDetailsResponse['auth_method'];

export type AuthContext = {
  extra: {
    readOnly?: boolean;
    authMethod: AuthMethod;
    account: {
      id: string;
      name: string;
      email?: string;
      isOrg?: boolean; // For STDIO mode with org API key
    };
    client?: {
      id: string;
      name: string;
    };
    [key: string]: unknown;
  };
} & AuthInfo;
