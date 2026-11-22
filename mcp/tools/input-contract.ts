import { fromJsonSchema } from '@modelcontextprotocol/server';
import { toListedInputSchema } from './listed-schema';
import type { ToolInputSchema } from './tool-definition';

// The SDK's validator keeps every schema it compiles, keyed by object
// identity, so a schema converted per request is compiled and retained per
// request.
const contracts = new WeakMap<
  ToolInputSchema,
  ReturnType<typeof fromJsonSchema>
>();

/** The published form of `inputSchema`, compiled once with the SDK's validator. */
export const inputContract = (inputSchema: ToolInputSchema) => {
  const cached = contracts.get(inputSchema);

  if (cached !== undefined) {
    return cached;
  }

  const listed = toListedInputSchema(inputSchema);
  const contract = fromJsonSchema(listed);

  contracts.set(inputSchema, contract);

  return contract;
};
