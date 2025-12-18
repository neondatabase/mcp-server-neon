import { createApiClient } from '@neondatabase/api-client';
import path from 'path';
import { MCPClient } from '../../mcp-client/src/index.js';

export async function deleteNonDefaultBranches(projectId: string) {
  const neonClient = createApiClient({
    apiKey: process.env.NEON_API_KEY!,
  });

  try {
    const allBranches = await neonClient.listProjectBranches({
      projectId: projectId,
    });

    const branchesToDelete = allBranches.data.branches.filter(
      (b) => !b.default,
    );

    await Promise.all(
      branchesToDelete.map((b) =>
        neonClient.deleteProjectBranch(b.project_id, b.id),
      ),
    );
  } catch (e) {
    console.error(e);
  }
}

export async function evaluateTask(input: string) {
  const client = new MCPClient({
    command: path.resolve(__dirname, '../../dist/index.js'),
    args: ['start', process.env.NEON_API_KEY!],
    loggerOptions: {
      mode: 'error',
    },
  });

  await client.start();
  const response = await client.processQuery(input);
  await client.stop();

  if (!response) {
    throw new Error('No response from MCP Client');
  }

  return response;
}
