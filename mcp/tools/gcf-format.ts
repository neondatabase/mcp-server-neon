/**
 * Optional Graph Compact Format (GCF) encoding for row-shaped tool results.
 *
 * Opt-in via `NEON_MCP_RESPONSE_FORMAT=gcf`. When enabled, a tool result that is an array
 * of uniform row objects (for example the rows from `run_sql`) is encoded as a
 * {@link https://gcformat.com Graph Compact Format} generic-profile block instead of JSON:
 * the repeated column names of the row array are factored into a single header, so the
 * result costs fewer tokens when it crosses the LLM boundary.
 *
 * The substitution is conservative and never changes what a model can read: GCF is used only
 * when it encodes without error, is strictly smaller than the compact JSON the same rows
 * would produce (never-grow), and decodes back to the same rows (lossless). Otherwise the
 * normal pretty-printed JSON is returned.
 */
import { decodeGeneric, encodeGeneric } from '@blackwell-systems/gcf';

import { RESPONSE_FORMAT } from '../../lib/config';

type TextContent = {
  type: 'text';
  text: string;
};

/** The pretty-printed JSON content block this server returns by default. */
function jsonContent(result: unknown): TextContent {
  return { type: 'text', text: JSON.stringify(result, null, 2) };
}

function isRowArray(value: unknown): value is Array<Record<string, unknown>> {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (row) => row !== null && typeof row === 'object' && !Array.isArray(row),
    )
  );
}

/** Order-aware, Map-aware deep equality. gcf-typescript `decodeGeneric` returns Map objects. */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a instanceof Map) a = Object.fromEntries(a);
  if (b instanceof Map) b = Object.fromEntries(b);
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => valuesEqual(x, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a as object).sort();
    const bk = Object.keys(b as object).sort();
    return (
      ak.length === bk.length &&
      ak.every(
        (k, i) =>
          k === bk[i] &&
          valuesEqual(
            (a as Record<string, unknown>)[k],
            (b as Record<string, unknown>)[k],
          ),
      )
    );
  }
  return a === b;
}

/**
 * Formats a tool result as a text content block, using GCF when opted in and it is a net win.
 *
 * GCF is emitted only for an array of uniform row objects, only when `NEON_MCP_RESPONSE_FORMAT`
 * is `gcf`, only when the wire is strictly smaller than compact JSON (never-grow), and only
 * when it round-trips back to the same rows (lossless). Any other case returns pretty JSON.
 */
export function formatToolResult(result: unknown): TextContent {
  if (RESPONSE_FORMAT !== 'gcf' || !isRowArray(result)) {
    return jsonContent(result);
  }

  try {
    const json = jsonContent(result);
    const wire = encodeGeneric(result);
    // Never-grow: only substitute when strictly smaller than the JSON this tool would
    // otherwise return, so enabling GCF can never make a response larger than it is today.
    if (wire.length >= json.text.length) {
      return json;
    }
    // Fail-safe: require a lossless round-trip back to the rows.
    if (!valuesEqual(decodeGeneric(wire), result)) {
      return json;
    }
    return { type: 'text', text: wire };
  } catch {
    return jsonContent(result);
  }
}
