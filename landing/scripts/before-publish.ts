#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function checkMainBranch(version: string) {
  // Skip main branch check for beta versions
  if (version.includes('beta')) {
    return;
  }

  try {
    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf8',
    }).trim();

    if (currentBranch !== 'main') {
      console.error(
        '\x1b[31mError: Publishing stable versions is only allowed from the main branch\x1b[0m'
      );
      console.error(`Current branch: ${currentBranch}`);
      process.exit(1);
    }
  } catch {
    console.error('Error: Git repository not found');
    process.exit(1);
  }
}

function checkChangelog() {
  const changelogPath = path.join(__dirname, '../CHANGELOG.md');
  const packagePath = path.join(__dirname, '../package.json');

  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const version = packageJson.version;

  try {
    const changelog = fs.readFileSync(changelogPath, 'utf8');
    if (!changelog.includes(version)) {
      console.error(
        `\x1b[31mError: Version ${version} not found in CHANGELOG.md\x1b[0m`
      );
      console.error('Please update the changelog before publishing');
      process.exit(1);
    }
    return version;
  } catch {
    console.error('\x1b[31mError: CHANGELOG.md not found\x1b[0m');
    process.exit(1);
  }
}

function beforePublish() {
  const version = checkChangelog();
  checkMainBranch(version);
}

beforePublish();
