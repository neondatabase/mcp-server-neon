import { AuthContext } from './auth';

// to make the file a module and avoid the TypeScript error
export {};

// Extends the Express Request interface to add the auth context
declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    export interface Request {
      auth?: AuthContext;
    }
  }
}
