import { ReadResourceCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Resource } from "@modelcontextprotocol/sdk/types.js";

export async function fetchRawGithubContent(rawPath: string) {
  const path = rawPath.replace("/blob", "");

  const response = await fetch(`https://raw.githubusercontent.com${path}`);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch GitHub content: ${response.status} ${response.statusText}`,
    );
  }
  return response.text();
}

export const NEON_RESOURCES = [
  {
    name: "neon-auth",
    uri: "https://github.com/neondatabase-labs/ai-rules/blob/main/neon-auth.mdc",
    mimeType: "text/plain",
    description: "Neon Auth usage instructions",
    handler: async (url) => {
      const uri = url.host;
      const rawPath = url.pathname;
      const content = await fetchRawGithubContent(rawPath);
      return {
        contents: [
          {
            uri: uri,
            mimeType: "text/plain",
            text: content,
          },
        ],
      };
    },
  },
  {
    name: "neon-serverless",
    uri: "https://github.com/neondatabase-labs/ai-rules/blob/main/neon-serverless.mdc",
    mimeType: "text/plain",
    description: "Neon Serverless usage instructions",
    handler: async (url) => {
      const uri = url.host;
      const rawPath = url.pathname;
      const content = await fetchRawGithubContent(rawPath);
      return {
        contents: [
          {
            uri,
            mimeType: "text/plain",
            text: content,
          },
        ],
      };
    },
  },
  {
    name: "neon-drizzle",
    uri: "https://github.com/neondatabase-labs/ai-rules/blob/main/neon-drizzle.mdc",
    mimeType: "text/plain",
    description: "Neon Drizzle usage instructions",
    handler: async (url) => {
      const uri = url.host;
      const rawPath = url.pathname;
      const content = await fetchRawGithubContent(rawPath);
      return {
        contents: [
          {
            uri,
            mimeType: "text/plain",
            text: content,
          },
        ],
      };
    },
  },
  {
    name: "neon-get-started",
    uri: "https://github.com/neondatabase-labs/ai-rules/blob/main/neon-get-started.mdc",
    mimeType: "text/markdown",
    description: "Neon getting started guide",
    handler: async (url) => {
      const uri = url.host;
      const rawPath = url.pathname;
      const content = await fetchRawGithubContent(rawPath);
      return {
        contents: [
          {
            uri,
            mimeType: "text/markdown",
            text: content,
          },
        ],
      };
    },
  },
  {
    name: "neon-js",
    uri: "https://github.com/neondatabase-labs/ai-rules/blob/main/neon-js.mdc",
    mimeType: "text/plain",
    description: "Neon JS SDK usage instructions",
    handler: async (url) => {
      const uri = url.host;
      const rawPath = url.pathname;
      const content = await fetchRawGithubContent(rawPath);
      return {
        contents: [
          {
            uri,
            mimeType: "text/plain",
            text: content,
          },
        ],
      };
    },
  },
] satisfies (Resource & { handler: ReadResourceCallback })[];
