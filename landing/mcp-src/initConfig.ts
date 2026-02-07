import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import chalk from 'chalk';
import { logger } from './utils/logger';
import type { CliGrantArgs } from './utils/grant-context';
import pkg from '../package.json';

// Determine Claude config path based on OS platform
let claudeConfigPath: string;
const platform = os.platform();

if (platform === 'win32') {
  // Windows path - using %APPDATA%
  claudeConfigPath = path.join(
    process.env.APPDATA || '',
    'Claude',
    'claude_desktop_config.json',
  );
} else {
  // macOS and Linux path (according to official docs)
  claudeConfigPath = path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'Claude',
    'claude_desktop_config.json',
  );
}

const MCP_NEON_SERVER = 'neon';

type Args =
  | {
      command: 'start:sse';
      analytics: boolean;
    }
  | {
      command: 'start';
      neonApiKey: string;
      analytics: boolean;
      grantArgs: CliGrantArgs;
    }
  | {
      command: 'init';
      executablePath: string;
      neonApiKey: string;
      analytics: boolean;
    }
  | {
      command: 'export-tools';
    };

const commands = ['init', 'start', 'start:sse', 'export-tools'] as const;

/**
 * Parse a named flag from the remaining args.
 * Supports: --flag value and --flag=value
 */
function parseFlag(
  remainingArgs: string[],
  flagName: string,
): string | undefined {
  for (let i = 0; i < remainingArgs.length; i++) {
    const arg = remainingArgs[i];
    // --flag=value
    if (arg.startsWith(`--${flagName}=`)) {
      return arg.slice(`--${flagName}=`.length);
    }
    // --flag value
    if (arg === `--${flagName}` && i + 1 < remainingArgs.length) {
      const next = remainingArgs[i + 1];
      if (!next.startsWith('--')) {
        return next;
      }
    }
  }
  return undefined;
}

/**
 * Check if a boolean flag is present in the remaining args.
 * For --protect-production, it can be a boolean flag (no value) or have a value.
 */
function parseBooleanOrValueFlag(
  remainingArgs: string[],
  flagName: string,
): string | undefined {
  for (let i = 0; i < remainingArgs.length; i++) {
    const arg = remainingArgs[i];
    // --flag=value
    if (arg.startsWith(`--${flagName}=`)) {
      return arg.slice(`--${flagName}=`.length);
    }
    // --flag (boolean) or --flag value
    if (arg === `--${flagName}`) {
      const next = remainingArgs[i + 1];
      if (next && !next.startsWith('--')) {
        return next;
      }
      return 'true';
    }
  }
  return undefined;
}

/**
 * Parse grant-related CLI flags from remaining args (after command and API key).
 */
function parseGrantArgs(remainingArgs: string[]): CliGrantArgs {
  return {
    preset: parseFlag(remainingArgs, 'preset'),
    scopes: parseFlag(remainingArgs, 'scopes'),
    projectId: parseFlag(remainingArgs, 'project-id'),
    protectProduction: parseBooleanOrValueFlag(
      remainingArgs,
      'protect-production',
    ),
  };
}

export const parseArgs = (): Args => {
  const args = process.argv;

  if (args.length < 3) {
    logger.error('Invalid number of arguments');
    process.exit(1);
  }

  if (args.length === 3 && args[2] === 'start:sse') {
    return {
      command: 'start:sse',
      analytics: true,
    };
  }

  if (args.length === 3 && args[2] === 'export-tools') {
    return {
      command: 'export-tools',
    };
  }

  const command = args[2];

  if (!commands.includes(command as (typeof commands)[number])) {
    logger.error(`Invalid command: ${command}`);
    process.exit(1);
  }

  if (command === 'export-tools') {
    return {
      command: 'export-tools',
    };
  }

  if (args.length < 4) {
    logger.error(
      'Please provide a NEON_API_KEY as a command-line argument - you can get one through the Neon console: https://neon.tech/docs/manage/api-keys',
    );
    process.exit(1);
  }

  // Remaining args after command and API key
  const remainingArgs = args.slice(4);
  const analytics = !remainingArgs.some((a) => a.includes('no-analytics'));

  if (command === 'init') {
    return {
      executablePath: args[1],
      command: 'init',
      neonApiKey: args[3],
      analytics,
    };
  }

  return {
    command: 'start',
    neonApiKey: args[3],
    analytics,
    grantArgs: parseGrantArgs(remainingArgs),
  };
};

export function handleInit({
  executablePath,
  neonApiKey,
  analytics,
}: {
  executablePath: string;
  neonApiKey: string;
  analytics: boolean;
}) {
  // If the executable path is a local path to the dist/index.js file, use it directly
  // Otherwise, use the name of the package to always load the latest version from remote
  const serverPath = executablePath.includes('dist/')
    ? executablePath
    : pkg.name;

  const neonConfig = {
    command: 'npx',
    args: [
      '-y',
      serverPath,
      'start',
      neonApiKey,
      analytics ? '' : '--no-analytics',
    ],
  };

  const configDir = path.dirname(claudeConfigPath);
  if (!fs.existsSync(configDir)) {
    console.log(chalk.blue('Creating Claude config directory...'));
    fs.mkdirSync(configDir, { recursive: true });
  }

  const existingConfig = fs.existsSync(claudeConfigPath)
    ? JSON.parse(fs.readFileSync(claudeConfigPath, 'utf8'))
    : { mcpServers: {} };

  if (MCP_NEON_SERVER in (existingConfig?.mcpServers || {})) {
    console.log(chalk.yellow('Replacing existing Neon MCP config...'));
  }

  const newConfig = {
    ...existingConfig,
    mcpServers: {
      ...existingConfig.mcpServers,
      [MCP_NEON_SERVER]: neonConfig,
    },
  };

  fs.writeFileSync(claudeConfigPath, JSON.stringify(newConfig, null, 2));
  console.log(chalk.green(`Config written to: ${claudeConfigPath}`));
  console.log(
    chalk.blue(
      'The Neon MCP server will start automatically the next time you open Claude.',
    ),
  );
}
