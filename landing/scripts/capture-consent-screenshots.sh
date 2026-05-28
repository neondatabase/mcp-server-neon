#!/usr/bin/env bash
# Capture marketing screenshots of the OAuth consent UI via the
# `agent-browser` global CLI (https://www.npmjs.com/package/agent-browser).
#
# Usage (from `landing/`):
#   pnpm run dev   # in another terminal, with .env.e2e exported
#   ./scripts/capture-consent-screenshots.sh
#
# Requirements:
#   - `agent-browser` installed globally (`npm i -g agent-browser`)
#   - A Next.js dev server reachable at $BASE_URL (defaults to
#     http://localhost:3100) with a working OAUTH_DATABASE_URL +
#     COOKIE_SECRET
#   - `jq` for JSON parsing of /api/register responses
#   - `curl` for hitting the registration + authorize endpoints
#
# Behavior:
#   - Each scenario re-registers a fresh OAuth client so we don't rely on
#     prior state.
#   - The daemonized agent-browser session persists across commands;
#     `agent-browser close --all` at the end tears it down.

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3100}"
OUT_DIR="${OUT_DIR:-/tmp/consent-screenshots}"
CLIENT_NAME="Codex CLI"
CLIENT_URI="https://github.com/cursor/codex"
REDIRECT_URI="http://127.0.0.1:55667/callback"

mkdir -p "$OUT_DIR"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

register_client() {
  curl -fsS -X POST "$BASE_URL/api/register" \
    -H 'content-type: application/json' \
    -d "$(cat <<JSON
{
  "client_name": "$CLIENT_NAME",
  "client_uri": "$CLIENT_URI",
  "redirect_uris": ["$REDIRECT_URI"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none"
}
JSON
)" | jq -r '.client_id'
}

urlencode() {
  node -e "console.log(encodeURIComponent(process.argv[1]))" -- "$1"
}

consent_url() {
  local client_id="$1"
  local extra_query="${2:-}"
  local scope="${3:-read+write}"
  local url="$BASE_URL/api/authorize?response_type=code&client_id=$client_id&redirect_uri=$(urlencode "$REDIRECT_URI")&scope=$scope&state=screenshot"
  if [[ -n "$extra_query" ]]; then
    url="$url&$extra_query"
  fi
  curl -fsS -D - -o /dev/null "$url" \
    | awk 'tolower($1) == "location:" { print substr($0, index($0,$2)) }' \
    | tr -d '\r\n'
}

shoot() {
  local name="$1"
  local description="$2"
  local out="$OUT_DIR/$name.png"
  # Wait for the live preview's debounced fetch + render to settle.
  agent-browser wait 1200 >/dev/null
  agent-browser screenshot --full "$out" >/dev/null
  echo "[shot] $out — $description"
}

# Initial daemon settings: dark color scheme + a desktop viewport that
# gives the form room to breathe without forcing horizontal compression.
# Closing first ensures we start from a clean session if the user has
# `agent-browser` already attached to another tab on the same machine.
agent-browser close --all >/dev/null 2>&1 || true
agent-browser set viewport 1280 1600 2 >/dev/null
agent-browser set color-scheme dark >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# Scenarios
#
# Driving the form: agent-browser dispatches its `click` action via CDP
# `Input.dispatchMouseEvent`, which works fine for native HTML controls
# (label clicks, role=radio buttons) but doesn't always reach React's
# synthetic event delegation for plain `<button onClick={…}>` triggers
# (Clear all / Select all). We work around that by triggering the click
# via `agent-browser eval` (programmatic `.click()` on the DOM node)
# whenever a click target is a plain React-handled button.
# ---------------------------------------------------------------------------

click_button_by_text() {
  local text="$1"
  agent-browser eval "Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '$text')?.click(); 'ok';" >/dev/null
}

# 1. Default — full access requested, all 7 categories
client_id=$(register_client)
url=$(consent_url "$client_id")
agent-browser open "$url" >/dev/null
shoot "01-default-full-access" "Default state: full access requested, all 7 categories"

# 2. User narrows to Querying + Schema and pins a project ID
client_id=$(register_client)
url=$(consent_url "$client_id")
agent-browser open "$url" >/dev/null
agent-browser wait 1000 >/dev/null
click_button_by_text "Clear all"
agent-browser find label "Querying" click >/dev/null
agent-browser find label "Schema" click >/dev/null
agent-browser find label "Project ID" fill "prj_demo_42" >/dev/null
shoot "02-narrowed-categories" "User narrows to Querying + Schema and pins a project ID"

# 3. User toggles to Read-only — destructive tools drop out
client_id=$(register_client)
url=$(consent_url "$client_id")
agent-browser open "$url" >/dev/null
agent-browser wait 800 >/dev/null
agent-browser find role radio click --name "Read-only" --exact >/dev/null
shoot "03-read-only-mode" "User toggles to Read-only — destructive tools drop out"

# 4. MCP client pinned a project ID via resource URI — input is locked
client_id=$(register_client)
url=$(consent_url "$client_id" "resource=$(urlencode "https://mcp.neon.tech/mcp?projectId=prj_pinned_demo")")
agent-browser open "$url" >/dev/null
shoot "04-client-pinned-project" "MCP client pinned a project ID via resource URI — input is locked"

# 5. MCP client capped categories to Querying+Schema — only those two render
client_id=$(register_client)
url=$(consent_url "$client_id" "resource=$(urlencode "https://mcp.neon.tech/mcp?category=querying&category=schema")")
agent-browser open "$url" >/dev/null
shoot "05-client-pinned-categories" "MCP client capped categories — only those two render"

# 6. MCP client mandated read-only via ?readonly=true — Full access disabled
client_id=$(register_client)
url=$(consent_url "$client_id" "resource=$(urlencode "https://mcp.neon.tech/mcp?readonly=true")" "read")
agent-browser open "$url" >/dev/null
shoot "06-readonly-locked" "MCP client mandated read-only via ?readonly=true — Full access disabled"

# Tear down the daemon so a follow-up run starts from a clean slate.
agent-browser close --all >/dev/null 2>&1 || true

echo "Done. Screenshots saved to $OUT_DIR"
