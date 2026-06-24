import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Authorization error | Neon MCP',
  robots: { index: false, follow: false },
};

const REASON_LABELS: Record<string, string> = {
  missing_state: 'The authorization request is missing required state.',
  invalid_state:
    'The authorization request has expired or was tampered with. Please retry from your MCP client.',
  invalid_client: 'The requesting client could not be found.',
  invalid_redirect: 'The requesting client redirect URI is not registered.',
};

export default async function ConsentErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const params = await searchParams;
  const reason =
    params.reason && params.reason in REASON_LABELS
      ? REASON_LABELS[params.reason]
      : 'The authorization request could not be processed.';

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="rounded-full border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
        Authorization error
      </div>
      <h1 className="text-2xl font-semibold text-neutral-100">
        Could not complete this authorization
      </h1>
      <p className="text-sm leading-relaxed text-neutral-400">{reason}</p>
      <p className="text-xs text-neutral-500">
        Retry from your MCP client. If the problem persists, see the{' '}
        <a
          href="https://neon.com/docs/ai/neon-mcp-server"
          className="underline decoration-dotted"
        >
          Neon MCP server docs
        </a>
        .
      </p>
    </div>
  );
}
