import { z } from 'zod';
import type { NeonTool, ToolInputSchema } from './tool-definition';

// Hosts may cache this schema and its instructions independently of the grant.
const PROJECT_ID_GUIDANCE =
  'Required for an unscoped connection. May be omitted when the connection is ' +
  'scoped to one project; if provided, it must match that project.';

const withProjectIdGuidance = (description: string | undefined): string => {
  const base = description?.trim();

  if (base === undefined || base === '') {
    return PROJECT_ID_GUIDANCE;
  }

  return `${/[.!?]$/u.test(base) ? base : `${base}.`} ${PROJECT_ID_GUIDANCE}`;
};

// One published schema per definition, so `inputContract` compiles it once
// instead of once per request.
const optionalProjectIdSchemas = new WeakMap<z.ZodObject, ToolInputSchema>();

const publishedSchema = (
  schema: z.ZodObject,
  projectIdSchema: z.ZodType,
): ToolInputSchema => {
  const cached = optionalProjectIdSchemas.get(schema);

  if (cached !== undefined) {
    return cached;
  }

  const published = z.strictObject({
    ...schema.shape,
    project_id: z
      .optional(projectIdSchema)
      .describe(
        withProjectIdGuidance(
          z.globalRegistry.get(projectIdSchema)?.description,
        ),
      ),
  });

  optionalProjectIdSchemas.set(schema, published);

  return published;
};

/** `tool` with `project_id` optional on the wire, or null when it has none. */
export const optionalProjectIdSchema = (tool: NeonTool): NeonTool | null => {
  const schema = tool.inputSchema;

  if (!tool.projectScoped || !(schema instanceof z.ZodObject)) {
    return null;
  }

  const projectIdSchema: unknown = schema.shape.project_id;

  if (!(projectIdSchema instanceof z.ZodType)) {
    return null;
  }

  return { ...tool, inputSchema: publishedSchema(schema, projectIdSchema) };
};
