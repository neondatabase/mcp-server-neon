import { app } from '../../../lib/http/app';

export const GET = async (request: Request): Promise<Response> =>
  app.handler(request);
