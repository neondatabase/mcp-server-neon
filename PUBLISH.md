# Publishing

All publishing commands should be run from the `landing/` directory.

```bash
cd landing
```

## New Release

```bash
bun run build:cli
npm version patch|minor|major
npm publish
```

## New Beta Release

```bash
bun run build:cli
npm version prerelease --preid=beta
npm publish --tag beta
```

## Promote Beta to Release

```bash
npm version patch
npm publish
```

## Pre-publish Checks

The `prepublishOnly` script automatically runs before publishing and verifies:

1. **Changelog updated**: The current version must be documented in `CHANGELOG.md`
2. **Main branch only**: Stable versions can only be published from the `main` branch (beta versions are exempt)
