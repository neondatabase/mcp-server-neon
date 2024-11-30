## Requirements

- Node.js
- Claude Desktop
- Neon API key - you can generate one through the Neon console: https://neon.tech/docs/manage/api-keys#create-an-api-key

## How to use locally

### Install and build the project:

```bash
npm install
npm run build
```

### Integrate with Claude

```bash
npx /path/to/mcp-server-neon/build/index.js <neon-api-key>
```

Restart Claude and you should be able to use the `list_projects` tool. For more information, check the official [Claude documentation](https://modelcontextprotocol.io/docs/first-server/typescript#connect-to-claude-desktop).
