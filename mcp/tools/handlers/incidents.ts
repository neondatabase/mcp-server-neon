import { createNeonTool } from '@neon/tools';

export const LIST_INCIDENTS_TOOL = createNeonTool('incidents.list', {});

export async function listIncidents(): Promise<string> {
  const { data } = await LIST_INCIDENTS_TOOL.execute({});
  return JSON.stringify(data, null, 2);
}
