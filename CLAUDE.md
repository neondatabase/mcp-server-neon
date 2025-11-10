# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the Neon MCP Server - a Model Context Protocol server that bridges natural language requests to the Neon API. It allows interaction with Neon Postgres databases through conversational AI interfaces.

The server supports both:
- Remote hosted MCP server (OAuth-based authentication)
- Local MCP server (API key authentication)

## Key Commands

### Development
```bash
npm run build          # Build TypeScript to dist/
npm run watch          # Watch mode with automatic rebuild and chmod
npm run typecheck      # Type check without emitting files
npm run lint           # Run typecheck, eslint, and prettier checks
npm run lint:fix       # Fix linting and formatting issues
npm run format         # Format code with prettier
```

### Testing
```bash
npm run test           # Run BrainTrust evaluations
```

### Server Operations
```bash
npm run start          # Start MCP server in stdio mode
npm run start:sse      # Start MCP server in SSE mode
npm run inspector      # Launch MCP inspector for debugging
npm run export-tools   # Export tool definitions to JSON
```

### Development Tools
```bash
# Local development with MCP CLI client
cd mcp-client/ && NEON_API_KEY=... npm run start:mcp-server-neon

# Local development with Claude Desktop
node dist/index.js init $NEON_API_KEY
```

### Landing Page (Next.js)
```bash
npm run build:landing # Build and copy landing page to public/
cd landing/ && npm run build  # Build landing page only
```

## Architecture

### Core Components

- **Entry Point** (`src/index.ts`): CLI argument parsing and transport initialization
- **Server** (`src/server/index.ts`): MCP server creation with tool and resource registration
- **Tools** (`src/tools/`): MCP tool definitions, handlers, and schema validation
- **Transports** (`src/transports/`): STDIO and SSE transport implementations
- **OAuth** (`src/oauth/`): OAuth2 authentication flow for remote server
- **Analytics** (`src/analytics/`): Segment integration for usage tracking
- **Landing Page** (`landing/`): Next.js application for documentation and tools display

### Tool System

Tools are defined in `src/tools/definitions.ts` and implemented in `src/tools/tools.ts`:
- Each tool has a schema definition with Zod validation
- Tool handlers receive validated parameters, Neon client, and context
- Tools support both project management (CRUD operations) and SQL execution
- Migration tools use Neon's branching feature for safe schema changes

### Key Features

- **Database Management**: Create/delete projects, branches, and execute SQL
- **Safe Migrations**: Temporary branch creation for testing schema changes
- **Query Performance**: Explain plans, slow query analysis, and optimization suggestions
- **Neon Auth Integration**: Stack Auth provisioning for authentication
- **Multi-transport Support**: STDIO for local clients, SSE for web interfaces

### Environment Configuration

Copy `.env.example` to `.env` and configure:
- `NEON_API_KEY`: Required for API operations
- `BRAINTRUST_API_KEY`: For running evaluations
- `ANTHROPIC_API_KEY`: For AI-powered evaluations
- OAuth settings for remote server mode

### TypeScript Configuration

- Target: ES2022 with Node16 module resolution
- Strict mode enabled
- Output to `dist/` directory
- Excludes test evaluations from compilation