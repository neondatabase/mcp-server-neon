import { landingMarkdownResponse } from '@/lib/landing';

export const GET = (req: Request): Response => landingMarkdownResponse(req);

export const HEAD = GET;
