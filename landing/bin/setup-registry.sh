#!/usr/bin/env bash
# Generates bunfig.toml for bun to use the Databricks npm proxy.
# Run once after cloning, or any time bunfig.toml is missing.
#
# CI runners generate their own bunfig.toml (see .github/workflows/pr.yml).

set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f bunfig.toml ]; then
  echo "bunfig.toml already exists, skipping."
  exit 0
fi

cat > bunfig.toml << 'EOF'
[install]
registry = "https://npm-proxy.dev.databricks.com/"
EOF

echo "Created bunfig.toml with Databricks npm proxy."
