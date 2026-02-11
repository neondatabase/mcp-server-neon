import { randomUUID } from "crypto";

/**
 * Generates a unique trace ID for correlating logs, analytics, and errors
 * across a single request/operation lifecycle.
 *
 * Format: UUID v4 (e.g., "550e8400-e29b-41d4-a716-446655440000")
 */
export function generateTraceId(): string {
  return randomUUID();
}
