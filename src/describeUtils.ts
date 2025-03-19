/**
 * This module is derived from @neondatabase/psql-describe
 * Original source: https://github.com/neondatabase/psql-describe
 */

import { neon } from '@neondatabase/serverless';

export interface TableDescription {
  columns: ColumnDescription[];
  indexes: IndexDescription[];
  constraints: ConstraintDescription[];
  tableSize: string;
  indexSize: string;
  totalSize: string;
}

export interface ColumnDescription {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  description: string | null;
}

export interface IndexDescription {
  name: string;
  definition: string;
  size: string;
}

export interface ConstraintDescription {
  name: string;
  type: string;
  definition: string;
}

export const DESCRIBE_TABLE_STATEMENTS = [
  // Get column information
  `
  SELECT 
    c.column_name as name,
    c.data_type as type,
    c.is_nullable = 'YES' as nullable,
    c.column_default as default,
    pd.description
  FROM information_schema.columns c
  LEFT JOIN pg_catalog.pg_statio_all_tables st ON c.table_schema = st.schemaname AND c.table_name = st.relname
  LEFT JOIN pg_catalog.pg_description pd ON pd.objoid = st.relid AND pd.objsubid = c.ordinal_position
  WHERE c.table_schema = 'public' AND c.table_name = $1
  ORDER BY c.ordinal_position;
  `,

  // Get index information
  `
  SELECT
    i.relname as name,
    pg_get_indexdef(i.oid) as definition,
    pg_size_pretty(pg_relation_size(i.oid)) as size
  FROM pg_class t
  JOIN pg_index ix ON t.oid = ix.indrelid
  JOIN pg_class i ON i.oid = ix.indexrelid
  WHERE t.relname = $1 AND t.relkind = 'r';
  `,

  // Get constraint information
  `
  SELECT
    tc.constraint_name as name,
    tc.constraint_type as type,
    pg_get_constraintdef(cc.oid) as definition
  FROM information_schema.table_constraints tc
  JOIN pg_catalog.pg_constraint cc ON tc.constraint_name = cc.conname
  WHERE tc.table_schema = 'public' AND tc.table_name = $1;
  `,

  // Get table size information
  `
  SELECT
    pg_size_pretty(pg_total_relation_size($1)) as total_size,
    pg_size_pretty(pg_relation_size($1)) as table_size,
    pg_size_pretty(pg_total_relation_size($1) - pg_relation_size($1)) as index_size;
  `
];

export async function describeTable(
  connectionString: string,
  tableName: string
): Promise<TableDescription> {
  const sql = neon(connectionString);

  // Execute all queries in parallel
  const [columns, indexes, constraints, sizes] = await Promise.all([
    sql(DESCRIBE_TABLE_STATEMENTS[0], [tableName]),
    sql(DESCRIBE_TABLE_STATEMENTS[1], [tableName]),
    sql(DESCRIBE_TABLE_STATEMENTS[2], [tableName]),
    sql(DESCRIBE_TABLE_STATEMENTS[3], [tableName])
  ]);

  return {
    columns: columns.map(col => ({
      name: col.name,
      type: col.type,
      nullable: col.nullable,
      default: col.default,
      description: col.description
    })),
    indexes: indexes.map(idx => ({
      name: idx.name,
      definition: idx.definition,
      size: idx.size
    })),
    constraints: constraints.map(con => ({
      name: con.name,
      type: con.type,
      definition: con.definition
    })),
    tableSize: sizes[0].table_size,
    indexSize: sizes[0].index_size,
    totalSize: sizes[0].total_size
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
  desc.columns.forEach(col => {
    const nullable = col.nullable ? 'NULL' : 'NOT NULL';
    const defaultStr = col.default ? ` DEFAULT ${col.default}` : '';
    const descStr = col.description ? `\n    ${col.description}` : '';
    lines.push(`  ${col.name} ${col.type} ${nullable}${defaultStr}${descStr}`);
  });
  lines.push('');

  // Add indexes
  if (desc.indexes.length > 0) {
    lines.push('Indexes:');
    desc.indexes.forEach(idx => {
      lines.push(`  ${idx.name} (${idx.size})`);
      lines.push(`    ${idx.definition}`);
    });
    lines.push('');
  }

  // Add constraints
  if (desc.constraints.length > 0) {
    lines.push('Constraints:');
    desc.constraints.forEach(con => {
      lines.push(`  ${con.name} (${con.type})`);
      lines.push(`    ${con.definition}`);
    });
  }

  return lines.join('\n');
} 