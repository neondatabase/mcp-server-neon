import { describe, expect, it } from 'vitest';
import {
  INSPECT_CHECK_LIST,
  INSPECT_CHECKS,
  INSPECT_DEFAULT_LIMIT,
  INSPECT_MAX_LIMIT,
  INSPECT_QUERIES,
} from '../inspect/queries';
import { inspectDatabaseInputSchema } from '../tools/toolsSchema';

describe('inspect query catalog', () => {
  it('offers a query for every check and no orphans', () => {
    expect(Object.keys(INSPECT_QUERIES).sort()).toEqual(
      [...INSPECT_CHECKS].sort(),
    );
  });

  it.each(INSPECT_CHECKS)('%s declares a complete entry', (check) => {
    const query = INSPECT_QUERIES[check];
    expect(query.describe.length).toBeGreaterThan(0);
    expect(query.emptyMessage.length).toBeGreaterThan(0);
    expect(query.fields.length).toBeGreaterThan(0);
    expect(query.sql.trim().length).toBeGreaterThan(0);
  });

  // The HTTP driver rejects multiple statements per query, so a check that
  // accidentally vendored two would only fail at runtime against a real database.
  it.each(INSPECT_CHECKS)('%s is a single statement', (check) => {
    const statements = INSPECT_QUERIES[check].sql
      .split(';')
      .filter((part) => part.trim().length > 0);
    expect(statements).toHaveLength(1);
  });

  it('documents every check for the model', () => {
    for (const check of INSPECT_CHECKS) {
      expect(INSPECT_CHECK_LIST).toContain(
        `\`${check}\`: ${INSPECT_QUERIES[check].describe}`,
      );
    }
  });
});

describe('inspectDatabaseInputSchema', () => {
  it('accepts every check the catalog offers', () => {
    for (const check of INSPECT_CHECKS) {
      const parsed = inspectDatabaseInputSchema.parse({
        check,
        projectId: 'project-1',
      });
      expect(parsed.check).toBe(check);
    }
  });

  it('rejects a check that is not in the catalog', () => {
    const result = inspectDatabaseInputSchema.safeParse({
      check: 'cache-hit',
      projectId: 'project-1',
    });
    expect(result.success).toBe(false);
  });

  it('caps rows by default and keeps the ceiling in range', () => {
    expect(
      inspectDatabaseInputSchema.parse({
        check: 'locks',
        projectId: 'project-1',
      }).limit,
    ).toBe(INSPECT_DEFAULT_LIMIT);
    expect(
      inspectDatabaseInputSchema.safeParse({
        check: 'locks',
        projectId: 'project-1',
        limit: 0,
      }).success,
    ).toBe(false);
    expect(
      inspectDatabaseInputSchema.safeParse({
        check: 'locks',
        projectId: 'project-1',
        limit: INSPECT_MAX_LIMIT,
      }).success,
    ).toBe(true);
    expect(
      inspectDatabaseInputSchema.safeParse({
        check: 'locks',
        projectId: 'project-1',
        limit: INSPECT_MAX_LIMIT + 1,
      }).success,
    ).toBe(false);
  });

  it('requires a project id', () => {
    expect(
      inspectDatabaseInputSchema.safeParse({ check: 'locks' }).success,
    ).toBe(false);
  });
});
