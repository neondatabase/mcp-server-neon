const SERVER_NAME = 'neon';

type InstallTargets = {
  claudeCode: string;
  cursor: string;
  vscode: string;
  vscodeInsiders: string;
  chatgptSteps: readonly (readonly [heading: string, instruction: string])[];
  addMcp: string;
  addMcpWithApiKey: string;
  mcpRemote: string;
  config: string;
};

const shellQuote = (value: string): string =>
  `'${value.replaceAll("'", String.raw`'\''`)}'`;

const vscodeConfig = (url: string): string =>
  encodeURIComponent(JSON.stringify({ url, name: SERVER_NAME, type: 'http' }));

export const getInstallTargets = (url: string): InstallTargets => {
  const cursorConfig = Buffer.from(JSON.stringify({ url })).toString('base64');

  return {
    claudeCode: `claude mcp add --transport http "${SERVER_NAME}" ${shellQuote(url)}`,
    cursor: `cursor://anysphere.cursor-deeplink/mcp/install?config=${encodeURIComponent(cursorConfig)}&name=${SERVER_NAME}`,
    vscode: `vscode:mcp/install?${vscodeConfig(url)}`,
    vscodeInsiders: `vscode-insiders:mcp/install?${vscodeConfig(url)}`,
    chatgptSteps: [
      [
        'Open Plugins',
        'In ChatGPT on the web, go to Plugins, select the plus button, then Add custom MCP server',
      ],
      [
        'Add this MCP server',
        `Name it Neon, enter ${url} as the Server URL, choose OAuth, accept the risk warning, then select Create as a plugin`,
      ],
      ['Install it', 'Find Neon in your personal plugins and install it'],
      ['Use in conversations', 'Type @ in the prompt box and select Neon'],
    ],
    addMcp: `npx add-mcp ${shellQuote(url)}`,
    addMcpWithApiKey: `npx add-mcp ${shellQuote(url)} --header "Authorization: Bearer <NEON_API_KEY>"`,
    mcpRemote: `npx -y mcp-remote ${shellQuote(url)}`,
    config: JSON.stringify(
      { mcpServers: { Neon: { type: 'http', url } } },
      null,
      2,
    ),
  };
};
