import {
  localhostAllowedOrigins,
  originValidationResponse,
} from '@modelcontextprotocol/server';
import { grantParamError } from '../../../mcp/transport/auth';
import { SERVER_HOST } from '../../config';
import { isWellFormedOrigin } from '../../origin';

// Local development is the local-server case the spec's DNS-rebinding rule
// targets, so `next dev` only accepts its own and localhost origins.
const DEV_ALLOWED_ORIGIN_HOSTNAMES = [
  new URL(SERVER_HOST).hostname,
  ...localhostAllowedOrigins(),
].filter((hostname, index, hostnames) => hostnames.indexOf(hostname) === index);

export const originRejection = (req: Request): Response | undefined => {
  if (process.env.NODE_ENV !== 'production') {
    return originValidationResponse(req, DEV_ALLOWED_ORIGIN_HOSTNAMES);
  }

  const origin = req.headers.get('origin');

  if (origin === null || isWellFormedOrigin(origin)) {
    return undefined;
  }

  return Response.json(
    {
      jsonrpc: '2.0',
      error: { code: -32_000, message: `Invalid Origin: ${origin}` },
      id: null,
    },
    { status: 403 },
  );
};

export const invalidGrantParamResponse = (
  url: URL,
  req: Request,
): Response | undefined => {
  const message = grantParamError(url.searchParams, req.headers);

  return message === undefined
    ? undefined
    : Response.json(
        { error: 'invalid_request', error_description: message },
        { status: 400 },
      );
};
