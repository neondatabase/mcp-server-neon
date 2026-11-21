import { isClientIdMetadataUrl } from './client-id-metadata-document';

/**
 * A client ID safe to put on a span: a metadata document URL may carry a query
 * string, which is left out. Only record a client the store resolved, so a
 * caller can't put arbitrary text on the span.
 */
export const clientIdForSpan = (clientId: string) => {
  if (!isClientIdMetadataUrl(clientId)) {
    return clientId;
  }

  const url = new URL(clientId);

  return `${url.origin}${url.pathname}`;
};
