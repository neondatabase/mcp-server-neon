<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://neon.com/brand/neon-logo-dark-color.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://neon.com/brand/neon-logo-light-color.svg">
  <img width="250px" alt="Neon Logo fallback" src="https://neon.com/brand/neon-logo-dark-color.svg">
</picture>

## MCP Client CLI

This is a CLI client that can be used to interact with any MCP server and its tools. For more, see [Building a CLI Client For Model Context Protocol Servers](https://neon.tech/blog/building-a-cli-client-for-model-context-protocol-servers).

## Requirements

- ANTHROPIC_API_KEY - Get one from [Anthropic](https://console.anthropic.com/)
- Node.js >= v18.0.0

## How to use

```bash
export ANTHROPIC_API_KEY=your_key_here
npx @neondatabase/mcp-client-cli --server-command="npx" --server-args="-y @neondatabase/mcp-server-neon start <neon-api-key>"
```

## How to develop

1. Clone the repository
2. Setup a `.env` file based on the `.env.example` file
3. Run `npm install`
4. Run `npm run start:mcp-server-neon`
