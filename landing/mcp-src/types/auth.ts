import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

export type AuthContext = {
  extra: {
    readOnly?: boolean;
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
