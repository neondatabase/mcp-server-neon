import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

export type AuthContext = {
  extra: {
    user: {
      id: string;
      name: string;
      email: string;
    };
    client: {
      id: string;
      name: string;
    };
    [key: string]: unknown;
  };
} & AuthInfo;
