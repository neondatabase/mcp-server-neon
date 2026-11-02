const SERIALIZED_ORIGIN = /^[a-z][a-z\d+.-]*:\/\/[^\s/?#]+$/i;

/**
 * The Streamable HTTP spec requires a 403 for a present, invalid `Origin` to
 * stop DNS rebinding against local servers. The deployed endpoint is public
 * and bearer-authenticated, so any serialized origin is valid there: web
 * pages, browser extensions (`chrome-extension://<id>`), desktop webviews
 * (`tauri://localhost`), and `null` from sandboxed or file-based pages.
 */
export function isWellFormedOrigin(origin: string): boolean {
  return (
    origin === 'null' ||
    (SERIALIZED_ORIGIN.test(origin) && URL.canParse(origin))
  );
}
