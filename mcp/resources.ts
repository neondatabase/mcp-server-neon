// Where the docs tools read Neon's documentation from. Overridable for the same
// reason NEON_API_HOST and NEON_TELEMETRY_API_HOST are: so a run can be pointed
// at a different origin than production. The e2e suite points it at a local
// fixture, which is what keeps a merge-gating test off the network.
export const NEON_DOCS_BASE_URL =
  process.env.NEON_DOCS_BASE_URL ?? 'https://neon.com';
export const NEON_DOCS_INDEX_URL = `${NEON_DOCS_BASE_URL}/docs/llms.txt`;
