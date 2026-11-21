import { mcpApp } from '../../../lib/http/mcp-app';

const handleRequest = async (request: Request): Promise<Response> =>
  mcpApp.handler(request);

// HEAD is exported explicitly. Next.js would otherwise route it to the GET export,
// which is the same function, but relying on that implicit mapping hides the fact
// that HEAD needs its own branch to avoid the mcp-handler timeout.
export {
  handleRequest as GET,
  handleRequest as POST,
  handleRequest as DELETE,
  handleRequest as HEAD,
};
