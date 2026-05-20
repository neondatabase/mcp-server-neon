---
name: neon-auth-v0-env
description: >-
  Provisions Neon Auth on a Neon branch, adds the user's v0 sandbox URL to the
  Neon Auth trusted-domains list, then prints shell exports for
  NEON_AUTH_BASE_URL and a 63-bit AUTH_SECRET. Use when wiring v0 (Vercel)
  sandboxes to Neon Auth, configuring trusted domains, or setting local env
  vars for Better Auth against Neon.
disable-model-invocation: true
---

# Neon Auth + v0 sandbox env exports

Use the **Neon MCP** tools from this repo's server (`neon_auth_provision`, `neon_auth_domain_update`) when they are available. Otherwise use the same operations via the Neon API / Console.

## Inputs to collect first

- `PROJECT_ID` — Neon project id.
- `BRANCH_ID` — optional; omit to use the default branch.
- `V0_TRUSTED_ORIGIN` — the v0 sandbox URL to trust. Neon Auth uses the trusted-domains list for both CSRF protection (validating the request `Origin`/`Referer` header) and as an allowlist for callback/redirect URLs the auth server will redirect users to (`callbackURL`, `redirectTo`, `errorCallbackURL`, `newUserCallbackURL`) across sign-in, OAuth provider, email verification, password reset, and magic-link flows. Common shapes (replace with the user's real preview URL):

  - Full origin: `https://<preview-host>.vercel.app`
  - Full callback URL: `https://<preview-host>.vercel.app/api/auth/callback`
  - Wildcard pattern (covers all v0 previews for the project): `https://*.vercel.app`

  Wildcards (`*`, `?`, `**`) and custom schemes (`myapp://`, `exp://...`) are accepted upstream — passing the broadest entry that matches the user's preview hostname pattern usually saves repeated updates as preview URLs change.

## Workflow

1. **Provision Neon Auth** (idempotent if already provisioned):

   - Tool: `neon_auth_provision`
   - Args: `{ "projectId": "<PROJECT_ID>", "branchId": "<BRANCH_ID optional>" }`
   - From the result text, note **`base_url`** (Better Auth–compatible service URL for the branch).

2. **Add the v0 sandbox URL to Neon Auth's trusted domains**:

   - Tool: `neon_auth_domain_update`
   - Args:
     ```json
     {
       "projectId": "<PROJECT_ID>",
       "branchId": "<BRANCH_ID optional>",
       "add": ["<V0_TRUSTED_ORIGIN>"]
     }
     ```
   - This tool accepts batch edits — pass `add[]` and/or `remove[]` arrays of URLs, plus an optional `allow_localhost` boolean for local-dev toggling, all in a single call.
   - If the value is already trusted, the tool may report success without error; treat as OK.

3. **Emit shell exports** for the user to paste into their terminal or `.env.local`:

   - **`NEON_AUTH_BASE_URL`** — set to the Neon Auth **`base_url`** returned by `neon_auth_provision` (no trailing slash unless the app requires it).
   - **`AUTH_SECRET`** (or the name their framework expects, e.g. `BETTER_AUTH_SECRET`) — a **63-bit** cryptographically random secret, URL-safe.

   **Generate a 63-bit secret (exactly 63 bits of entropy):**

   ```bash
   node -e "const c=require('crypto');const b=c.randomBytes(8);b[0]&=0x7f;process.stdout.write(b.toString('base64url'))"
   ```

   **Print exports** (escape values for the shell if they contain `'`):

   ```bash
   export NEON_AUTH_BASE_URL='https://…'   # from Neon Auth base_url
   export AUTH_SECRET='<output of node one-liner above>'
   ```

   Remind the user: **never commit** real `AUTH_SECRET` values; use platform secrets (Vercel env, etc.) for v0 deployments.

## Checklist

- [ ] `neon_auth_provision` succeeded (or already provisioned — idempotent on 409).
- [ ] `neon_auth_domain_update` called with `add` containing a value that matches the URL the browser will actually hit (an origin, a full callback URL, or a wildcard pattern such as `https://*.vercel.app`).
- [ ] `NEON_AUTH_BASE_URL` matches Neon's **`base_url`** for that branch.
- [ ] `AUTH_SECRET` generated with the 63-bit `node -e` snippet above.

## Notes

- **Allow localhost** for local dev is part of the same tool — call `neon_auth_domain_update` with `{ "allow_localhost": true }` (or `false` to disable).
- v0 preview hostnames change per deployment. Either trust a wildcard pattern up front (e.g. `https://*.vercel.app`), or, when a new preview lands, call `neon_auth_domain_update` with `{ "add": ["<new>"], "remove": ["<old>"] }` in a single call to swap them atomically.
