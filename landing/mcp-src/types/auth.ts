import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { GrantContext } from '../utils/grant-context';

export type AuthContext = {
  extra: {
    readOnly?: boolean;
    grant?: GrantContext;
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
