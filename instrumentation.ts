// Sentry must be initialized before the first request: a request already in
// flight when it initializes runs on the default isolation scope, and every
// later request clones what that request writes there (user, tags).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./mcp/sentry/instrument');
  }
}
