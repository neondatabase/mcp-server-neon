---
name: neon-auth-v0-env
description: >-
  Provisions Neon Auth on a Neon branch, whitelists the user’s v0 sandbox OAuth
  redirect URL, then prints shell exports for NEON_AUTH_BASE_URL and a
  63-bit AUTH_SECRET. Use when wiring v0 (Vercel) sandboxes to Neon Auth,
  trusted redirect URIs, or local env vars for Better Auth against Neon.
disable-model-invocation: true
---

# Neon Auth + v0 sandbox env exports

Use the **Neon MCP** tools from this repo’s server (`provision_neon_auth`, `configure_neon_auth`, `get_neon_auth_config`) when they are available. Otherwise use the same operations via Neon API / Console.

## Inputs to collect first

- `PROJECT_ID` — Neon project id.
- `BRANCH_ID` — optional; omit to use the default branch.
- `V0_REDIRECT_URI` — **full HTTPS callback URL** the v0 sandbox uses for auth (must be a valid URL; Neon stores trusted entries as URIs). Example shapes (replace with the user’s real preview URL):

  - `https://<preview-host>.vercel.app/api/auth/callback`
  - `https://<preview-host>.vercel.app/callback`

  If the user only has a v0 **origin** (no path), append the path their Better Auth / Auth.js handler actually uses (often `/api/auth/callback`).

## Workflow

1. **Provision Neon Auth** (idempotent if already provisioned):

   - Tool: `provision_neon_auth`
   - Args: `{ "projectId": "<PROJECT_ID>", "branchId": "<BRANCH_ID optional>" }`
   - From the result text, note **`base_url`** (Better Auth–compatible service URL for the branch).

2. **Whitelist the v0 sandbox redirect URI**:

   - Tool: `configure_neon_auth`
   - Args:
     ```json
     {
       "operation": "add_redirect_uri",
       "projectId": "<PROJECT_ID>",
       "branchId": "<BRANCH_ID optional>",
       "redirect_uri": "<V0_REDIRECT_URI>"
     }
     ```
   - If the URI is already allowed, the tool may report success without error; treat as OK.

3. **Read `base_url` / `jwks_url` (optional but recommended)**:

   - Tool: **`get_neon_auth_config`**
   - Args: `{ "projectId": "<PROJECT_ID>", "branchId": "<BRANCH_ID optional>" }`
   - The JSON includes top-level **`base_url`**, **`jwks_url`**, **`db_name`**, **`branch_name`**, and an **`integration`** object with the full Neon Auth integration payload from the API.

   You can skip step 1 if Neon Auth is already provisioned and you only need URLs: **`get_neon_auth_config`** alone is enough to read **`base_url`** and **`jwks_url`**.

4. **Emit shell exports** for the user to paste into their terminal or `.env.local`:

   - **`NEON_AUTH_BASE_URL`** — set to the Neon Auth **`base_url`** (no trailing slash unless the app requires it).
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

- [ ] `provision_neon_auth` succeeded (or already provisioned).
- [ ] `add_redirect_uri` used the **exact** callback URL the browser will hit (scheme + host + path).
- [ ] `NEON_AUTH_BASE_URL` matches Neon’s **`base_url`** for that branch.
- [ ] `AUTH_SECRET` generated with the 63-bit `node -e` snippet above.

## Notes

- **Allow localhost** for local dev is separate; use `configure_neon_auth` with `operation: "set_allow_localhost"` only when needed.
- v0 preview hostnames change per deployment; when the sandbox URL changes, **add** the new `redirect_uri` (and optionally remove old ones) with `configure_neon_auth`.
