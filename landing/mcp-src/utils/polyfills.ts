import nodeFetch, {
  Headers as NodeHeaders,
  Request as NodeRequest,
  Response as NodeResponse,
} from 'node-fetch';

// Use different names to avoid conflicts
declare global {
  function fetch(
    url: string | Request | URL,
    init?: RequestInit,
  ): Promise<Response>;
}

if (!global.fetch) {
  global.fetch = nodeFetch as any;
  global.Headers = NodeHeaders as any;
  global.Request = NodeRequest as any;
  global.Response = NodeResponse as any;
}
