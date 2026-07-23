/**
 * This module is derived from @neondatabase/psql-describe
 * Original source: https://github.com/neondatabase/psql-describe
 */

import { neon } from '@neondatabase/serverless';

type TableDescription = {
  columns: ColumnDescription[];
  indexes: IndexDescription[];
  constraints: ConstraintDescription[];
  tableSize: string;
  indexSize: string;
  totalSize: string;
};

type ColumnDescription = {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  description: string | null;
};

type IndexDescription = {
  name: string;
  definition: string;
  size: string;
};

type ConstraintDescription = {
  name: string;
  type: string;
  definition: string;
};

const DESCRIBE_TABLE_STATEMENTS = [
  // Get column information
  `
  WITH target AS (
    SELECT
      cls.oid,
      ns.nspname AS table_schema,
      cls.relname AS table_name
    FROM pg_catalog.pg_class cls
    JOIN pg_catalog.pg_namespace ns ON ns.oid = cls.relnamespace
    WHERE cls.oid = $1::regclass
  )
  SELECT 
    c.column_name as name,
    c.data_type as type,
    c.is_nullable = 'YES' as nullable,
    c.column_default as default,
    pd.description
  FROM target t
  JOIN information_schema.columns c
    ON c.table_schema = t.table_schema
    AND c.table_name = t.table_name
  LEFT JOIN pg_catalog.pg_description pd
    ON pd.objoid = t.oid
    AND pd.objsubid = c.ordinal_position
  ORDER BY c.ordinal_position;
  `,

  // Get index information
  `
  WITH target AS (
    SELECT $1::regclass AS oid
  )
  SELECT
    i.relname as name,
    pg_get_indexdef(i.oid) as definition,
    pg_size_pretty(pg_relation_size(i.oid)) as size
  FROM target target
  JOIN pg_catalog.pg_class t ON t.oid = target.oid
  JOIN pg_catalog.pg_index ix ON t.oid = ix.indrelid
  JOIN pg_catalog.pg_class i ON i.oid = ix.indexrelid
  WHERE t.relkind = 'r';
  `,

  // Get constraint information
  `
  WITH target AS (
    SELECT
      cls.oid,
      ns.nspname AS table_schema,
      cls.relname AS table_name
    FROM pg_catalog.pg_class cls
    JOIN pg_catalog.pg_namespace ns ON ns.oid = cls.relnamespace
    WHERE cls.oid = $1::regclass
  )
  SELECT
    tc.constraint_name as name,
    tc.constraint_type as type,
    pg_get_constraintdef(cc.oid) as definition
  FROM target t
  JOIN information_schema.table_constraints tc
    ON tc.table_schema = t.table_schema
    AND tc.table_name = t.table_name
  JOIN pg_catalog.pg_constraint cc
    ON cc.conrelid = t.oid
    AND cc.conname = tc.constraint_name;
  `,

  // Get table size information
  `
  SELECT
    pg_size_pretty(pg_total_relation_size($1::regclass)) as total_size,
    pg_size_pretty(pg_relation_size($1::regclass)) as table_size,
    pg_size_pretty(
      pg_total_relation_size($1::regclass) - pg_relation_size($1::regclass)
    ) as index_size;
  `,
];

export async function describeTable(
  connectionString: string,
  tableName: string,
): Promise<TableDescription> {
  const sql = neon(connectionString);

  // Execute all queries in parallel
  const [columns, indexes, constraints, sizes] = await Promise.all([
    sql.query(DESCRIBE_TABLE_STATEMENTS[0], [tableName]),
    sql.query(DESCRIBE_TABLE_STATEMENTS[1], [tableName]),
    sql.query(DESCRIBE_TABLE_STATEMENTS[2], [tableName]),
    sql.query(DESCRIBE_TABLE_STATEMENTS[3], [tableName]),
  ]);

  return {
    columns: columns.map((col) => ({
      name: col.name,
      type: col.type,
      nullable: col.nullable,
      default: col.default,
      description: col.description,
    })),
    indexes: indexes.map((idx) => ({
      name: idx.name,
      definition: idx.definition,
      size: idx.size,
    })),
    constraints: constraints.map((con) => ({
      name: con.name,
      type: con.type,
      definition: con.definition,
    })),
    tableSize: sizes[0].table_size,
    indexSize: sizes[0].index_size,
    totalSize: sizes[0].total_size,
  };
}

export function formatTableDescription(desc: TableDescription): string {
  const lines: string[] = [];

  // Add table size information
  lines.push(`Table size: ${desc.tableSize}`);
  lines.push(`Index size: ${desc.indexSize}`);
  lines.push(`Total size: ${desc.totalSize}`);
  lines.push('');

  // Add columns
  lines.push('Columns:');
  desc.columns.forEach((col) => {
    const nullable = col.nullable ? 'NULL' : 'NOT NULL';
    const defaultStr = col.default ? ` DEFAULT ${col.default}` : '';
    const descStr = col.description ? `\n    ${col.description}` : '';
    lines.push(`  ${col.name} ${col.type} ${nullable}${defaultStr}${descStr}`);
  });
  lines.push('');

  // Add indexes
  if (desc.indexes.length > 0) {
    lines.push('Indexes:');
    desc.indexes.forEach((idx) => {
      lines.push(`  ${idx.name} (${idx.size})`);
      lines.push(`    ${idx.definition}`);
    });
    lines.push('');
  }

  // Add constraints
  if (desc.constraints.length > 0) {
    lines.push('Constraints:');
    desc.constraints.forEach((con) => {
      lines.push(`  ${con.name} (${con.type})`);
      lines.push(`    ${con.definition}`);
    });
  }

  return lines.join('\n');
}
