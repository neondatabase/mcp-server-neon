#!/usr/bin/env bash
# Generates bunfig.toml so bun uses an npm registry proxy.
# Checks multiple sources: BUN_CONFIG_REGISTRY env var, npm config, defaults.
# CI runners generate their own bunfig.toml (see .github/workflows/pr.yml).

set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f bunfig.toml ]; then
  exit 0
fi

# Check sources in priority order
if [ -n "${BUN_CONFIG_REGISTRY:-}" ]; then
  REGISTRY="$BUN_CONFIG_REGISTRY"
elif command -v npm &>/dev/null; then
  REGISTRY=$(npm config get registry 2>/dev/null || echo "https://registry.npmjs.org/")
else
  REGISTRY="https://registry.npmjs.org/"
fi

if echo "$REGISTRY" | grep -q "registry.npmjs.org"; then
  echo "Error: bun install requires an npm registry proxy on this network." >&2
  echo "" >&2
  echo "Fix with one of:" >&2
  echo "  1. Set globally:      echo 'registry=https://your-proxy.example.com/' >> ~/.npmrc" >&2
  echo "  2. Set for session:   BUN_CONFIG_REGISTRY=https://your-proxy.example.com/ bun install" >&2
  echo "  3. Create manually:   echo '[install]' > bunfig.toml && echo 'registry = \"https://your-proxy.example.com/\"' >> bunfig.toml" >&2
  exit 1
fi

cat > bunfig.toml << EOF
[install]
registry = "$REGISTRY"
EOF
