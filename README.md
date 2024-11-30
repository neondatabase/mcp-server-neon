## How to use

### Install and build the project:

```bash
npm install
npm run build
```

### Integrate with Claude

Open the claude config file:

```
code ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

Adapt the following configuration to look like this:

```json
{
  "mcpServers": {
    "mcp-server-neon": {
      "command": "node",
      "args": ["/path/to/mcp-server-neon/build/index.js"],
      "env": {
        "NEON_API_KEY": "API_KEY"
      }
    }
  }
}
```

Restart Claude and you should be able to use the `list_projects` tool. For more information, check the official [Claude documentation](https://modelcontextprotocol.io/docs/first-server/typescript#connect-to-claude-desktop).
