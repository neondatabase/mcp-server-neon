import { ReadResourceCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Resource } from '@modelcontextprotocol/sdk/types.js';

async function fetchRawGithubContent(path: string) {
  return fetch(`https://raw.githubusercontent.com${path}`).then((res) =>
    res.text(),
  );
}

export const NEON_RESOURCES = [
  {
    name: 'neon-auth',
    uri: 'https://github.com/neondatabase-labs/ai-rules/main/neon-auth.mdc',
    mimeType: 'text/plain',
    description: 'Neon Auth usage instructions',
    handler: async (url) => {
      const uri = url.host;
      const path = url.pathname;
      const content = await fetchRawGithubContent(path);
      return {
        contents: [
          {
            uri: uri,
            mimeType: 'text/plain',
            text: content,
          },
        ],
      };
    },
  },
  {
    name: 'neon-serverless',
    uri: 'https://github.com/neondatabase-labs/ai-rules/main/neon-serverless.mdc',
    mimeType: 'text/plain',
    description: 'Neon Serverless usage instructions',
    handler: async (url) => {
      const uri = url.host;
      const path = url.pathname;
      const content = await fetchRawGithubContent(path);
      return {
        contents: [
          {
            uri,
            mimeType: 'text/plain',
            text: content,
          },
        ],
      };
    },
  },
  {
    name: 'neon-drizzle',
    uri: 'https://github.com/neondatabase-labs/ai-rules/main/neon-drizzle.mdc',
    mimeType: 'text/plain',
    description: 'Neon Drizzle usage instructions',
    handler: async (url) => {
      const uri = url.host;
      const path = url.pathname;
      const content = await fetchRawGithubContent(path);
      return {
        contents: [
          {
            uri,
            mimeType: 'text/plain',
            text: content,
          },
        ],
      };
    },
  },
] satisfies (Resource & { handler: ReadResourceCallback })[];
