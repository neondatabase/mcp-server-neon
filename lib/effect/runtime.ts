import { layerGlobal } from '@effect/opentelemetry/OtelTracer';
import { Layer, ManagedRuntime } from 'effect';
import { WinstonLoggerLayer } from './logger';

// The HTTP app and the MCP callbacks build their layers through this map, so a
// layer both use is built once per instance.
export const memoMap = Layer.makeMemoMapUnsafe();

// MCP tool callbacks run inside mcp-handler, outside the HTTP app's request
// fibers. They get the same tracer, so tool spans nest under the request span.
export const mcpRuntime = ManagedRuntime.make(
  Layer.merge(layerGlobal, WinstonLoggerLayer),
  { memoMap },
);
