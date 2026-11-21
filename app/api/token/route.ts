import { app } from '../../../lib/http/app';

export const POST = async (request: Request): Promise<Response> =>
  app.handler(request);

export const OPTIONS = async (request: Request): Promise<Response> =>
  app.handler(request);
