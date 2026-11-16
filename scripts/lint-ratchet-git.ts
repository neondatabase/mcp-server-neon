import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const MAX_BUFFER = 256 * 1024 * 1024;

/** Returns stdout whatever the exit code: Oxlint exits non-zero when it finds something. */
export const runCommand = (
  bin: string,
  args: readonly string[],
  env = process.env,
): string => {
  const result = spawnSync(bin, args, {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  });

  if (result.error !== undefined) {
    throw result.error;
  }

  if (result.status !== 0 && result.stdout === '') {
    throw new Error(`${bin} ${args.join(' ')} failed: ${result.stderr}`);
  }

  return result.stdout;
};

/** A file as origin/main has it; undefined when main has no such file. */
export const onMain = (file: string): string | undefined =>
  runCommand('git', ['ls-tree', '--name-only', 'origin/main', file]).trim() ===
  ''
    ? undefined
    : runCommand('git', ['show', `origin/main:${file}`]);
