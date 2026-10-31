/**
 * The Streamable HTTP spec requires a 403 for a present, invalid `Origin` to
 * stop DNS rebinding against local servers. The deployed endpoint is public
 * and bearer-authenticated, so any well-formed origin is valid there,
 * including `null` from sandboxed or file-based pages.
 */
export function isWellFormedOrigin(origin: string): boolean {
  if (origin === 'null') return true;
  if (!URL.canParse(origin)) return false;
  const url = new URL(origin);
  return (
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    url.origin === origin
  );
}
