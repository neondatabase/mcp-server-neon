#!/usr/bin/env bash
# Generates bunfig.toml so bun uses the same registry as npm.
# Reads the registry from npm config (global ~/.npmrc or defaults).
# CI runners generate their own bunfig.toml (see .github/workflows/pr.yml).

set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f bunfig.toml ]; then
  exit 0
fi

REGISTRY=$(npm config get registry 2>/dev/null || echo "https://registry.npmjs.org/")

if echo "$REGISTRY" | grep -q "registry.npmjs.org"; then
  echo "Error: registry.npmjs.org is not reachable from this network." >&2
  echo "Configure an npm registry proxy in your global ~/.npmrc:" >&2
  echo '  registry=https://your-npm-proxy.example.com/' >&2
  exit 1
fi

cat > bunfig.toml << EOF
[install]
registry = "$REGISTRY"
EOF
