#!/usr/bin/env bash
# Validates that an npm registry proxy is configured for pnpm.
# Checks npm config and .npmrc; fails fast if the default registry.npmjs.org
# is in use (blocked on some networks).
# CI runners write their own .npmrc via JFrog OIDC (see .github/workflows/pr.yml).

set -euo pipefail

# Resolve registry from npm config or .npmrc
if command -v npm &>/dev/null; then
  REGISTRY=$(npm config get registry 2>/dev/null || echo "https://registry.npmjs.org/")
elif [ -f .npmrc ] && grep -q '^registry=' .npmrc; then
  REGISTRY=$(grep '^registry=' .npmrc | head -1 | cut -d= -f2-)
else
  REGISTRY="https://registry.npmjs.org/"
fi

if echo "$REGISTRY" | grep -q "registry.npmjs.org"; then
  echo "Error: pnpm install requires an npm registry proxy on this network." >&2
  echo "" >&2
  echo "Fix with one of:" >&2
  echo "  1. Set globally:      echo 'registry=https://your-proxy.example.com/' >> ~/.npmrc" >&2
  echo "  2. Set for project:   echo 'registry=https://your-proxy.example.com/' >> .npmrc" >&2
  exit 1
fi
