import { createNeonTool } from '@neon/tools';

export const LIST_INCIDENTS_TOOL = createNeonTool('incidents.list', {});

/** Reads neonstatus.com. Needs no Neon credential and sends none. */
export async function listIncidents(
  options: { fetch?: typeof fetch } = {},
): Promise<string> {
  const tool =
    options.fetch === undefined
      ? LIST_INCIDENTS_TOOL
      : createNeonTool('incidents.list', { fetch: options.fetch });
  const { data } = await tool.execute({});
  return JSON.stringify(data, null, 2);
}
