/**
 * Centralized configuration for the Vercel deployment.
 * This is the single source of truth for all configuration values.
 */

import { Config, Context, Effect, Layer, Option, Redacted } from 'effect';

// An empty SERVER_HOST or VERCEL_URL counts as unset.
const resolveServerHost = (env: {
  serverHost: Option.Option<string>;
  vercelUrl: Option.Option<string>;
}): string =>
  env.serverHost.pipe(
    Option.filter((host) => host.length > 0),
    Option.getOrElse(() =>
      env.vercelUrl.pipe(
        Option.filter((url) => url.length > 0),
        Option.match({
          onNone: () => 'http://localhost:3000',
          onSome: (url) => `https://${url}`,
        }),
      ),
    ),
  );

// The landing page (lib/landing) renders its content once at module load, so
// it reads the host here rather than through ServerConfig.
export const SERVER_HOST = resolveServerHost({
  serverHost: Option.fromNullishOr(process.env.SERVER_HOST),
  vercelUrl: Option.fromNullishOr(process.env.VERCEL_URL),
});

/** Configuration read through Effect `Config`, for code that runs on Effect. */
export class ServerConfig extends Context.Service<
  ServerConfig,
  {
    readonly serverHost: string;
    /** The upstream authorization server (Hydra). */
    readonly upstreamOAuthHost: string;
    /** This server's client at the upstream authorization server. */
    readonly clientId: string;
    readonly clientSecret: Redacted.Redacted;
  }
>()('@neondatabase/mcp-server-neon/lib/config/ServerConfig', {
  make: Effect.gen(function* () {
    // Local development and the web e2e suite run without upstream OAuth
    // credentials, and every route builds this layer, so they default to empty.
    const env = yield* Config.all({
      serverHost: Config.option(Config.String('SERVER_HOST')),
      vercelUrl: Config.option(Config.String('VERCEL_URL')),
      upstreamOAuthHost: Config.String('UPSTREAM_OAUTH_HOST').pipe(
        Config.withDefault('https://oauth2.neon.tech'),
      ),
      clientId: Config.String('CLIENT_ID').pipe(Config.withDefault('')),
      clientSecret: Config.Redacted('CLIENT_SECRET').pipe(
        Config.withDefault(Redacted.make('')),
      ),
    });

    return {
      serverHost: resolveServerHost(env),
      upstreamOAuthHost: env.upstreamOAuthHost,
      clientId: env.clientId,
      clientSecret: env.clientSecret,
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}

// The values below are read at module load, before any Effect runs.

// Neon API configuration
export const NEON_API_HOST =
  process.env.NEON_API_HOST ?? 'https://console.neon.tech/api/v2';

// Where get_doc reads page markdown from (`<base>/<slug>.md`). Overridable so
// the e2e suite can serve pages from a local fixture and stay off the network.
export const NEON_DOCS_BASE_URL =
  process.env.NEON_DOCS_BASE_URL ?? 'https://neon.com';

// Where search_docs posts to: neon-agent's site search (the assistant Neon
// Function), which also backs the neon.com search box. Overridable so the e2e
// suite can point it at a local fixture.
export const NEON_SITE_SEARCH_URL =
  process.env.NEON_SITE_SEARCH_URL ??
  'https://br-frosty-cell-a5smzg39-assistant.compute.c-1.us-east-2.aws.neon.tech/site-search';

// The OpenAPI spec search_api reads. Overridable so the e2e suite can serve a
// fixture spec and stay off the network.
export const NEON_API_SPEC_URL =
  process.env.NEON_API_SPEC_URL ?? 'https://neon.com/api_spec/release/v2.json';

// Where send_feedback posts to (the neondatabase/neon-feedback Function).
// Overridable so tests and local runs never send real feedback.
export const NEON_FEEDBACK_URL =
  process.env.NEON_FEEDBACK_URL ?? 'https://feedback.neon.tech/';

// Analytics and monitoring
export const ANALYTICS_WRITE_KEY =
  process.env.ANALYTICS_WRITE_KEY ?? 'gFVzt8ozOp6AZRXoD0g0Lv6UQ6aaoS7O';

// Overridable so tests can deliver events to a local collector.
export const ANALYTICS_HOST =
  process.env.ANALYTICS_HOST ?? 'https://track.neon.tech';

export const SENTRY_DSN =
  process.env.SENTRY_DSN ??
  'https://b3564134667aa2dfeaa3992a12d9c12f@o1373725.ingest.us.sentry.io/4509328350380033';
