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

cat > bunfig.toml << EOF
[install]
registry = "$REGISTRY"
EOF
