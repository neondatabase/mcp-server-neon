import { neon } from '@neondatabase/serverless';
import { neonClient } from '../../index.js';

import { TableSchema } from './schema-generator.js';

import { NEON_DEFAULT_ROLE_NAME } from '../../constants.js';

/**
 * Get connection string for the database
 *
 * @param projectId Neon project ID
 * @param branchId Neon branch ID
 * @param databaseName Database name
 * @returns Connection string URI
 */
export async function getConnectionString(
  projectId: string,
  branchId: string | undefined,
  databaseName: string,
): Promise<string> {
  const response = await neonClient.getConnectionUri({
    projectId,
    role_name: NEON_DEFAULT_ROLE_NAME,
    database_name: databaseName,
    branch_id: branchId,
  });

  return response.data.uri;
}

/**
 * Check if a table exists in the database
 *
 * @param projectId Neon project ID
 * @param branchId Neon branch ID
 * @param databaseName Database name
 * @param tableName Table name to check
 * @returns Boolean indicating if table exists
 */
export async function checkTableExists(
  projectId: string,
  branchId: string | undefined,
  databaseName: string,
  tableName: string,
): Promise<boolean> {
  try {
    const connectionString = await getConnectionString(
      projectId,
      branchId,
      databaseName,
    );
    const runQuery = neon(connectionString);

    const query = `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_name = $1
          AND table_schema = 'public'
      );
    `;

    const result = await runQuery(query, [tableName]);
    return result && result.length > 0 && result[0].exists;
  } catch (error: any) {
    console.error('Error checking if table exists:', error);
    throw new Error(`Could not check if table exists: ${error.message}`);
  }
}

/**
 * Create a new table in the database
 *
 * @param projectId Neon project ID
 * @param branchId Neon branch ID
 * @param databaseName Database name
 * @param tableName Table name to create
 * @param schema Table schema
 * @returns Result object with success flag and optional error
 */
export async function createTable(
  projectId: string,
  branchId: string | undefined,
  databaseName: string,
  tableName: string,
  schema: TableSchema,
): Promise<{ success: boolean; error?: string }> {
  try {
    const connectionString = await getConnectionString(
      projectId,
      branchId,
      databaseName,
    );
    const runQuery = neon(connectionString);

    // Generate CREATE TABLE SQL
    let sql = `CREATE TABLE "${tableName}" (\n`;

    // Add column definitions
    const columnDefs = schema.columns.map((column: any) => {
      let def = `  "${column.name}" ${column.dataType}`;
      if (!column.nullable) def += ' NOT NULL';
      if (column.isPrimaryKey) def += ' PRIMARY KEY';
      return def;
    });

    sql += columnDefs.join(',\n');
    sql += '\n);';

    // Create the table
    await runQuery(sql);

    // Add indexes (separate statements)
    const indexPromises = schema.columns
      .filter((column) => column.needsIndex && !column.isPrimaryKey)
      .map((column) =>
        runQuery(
          `CREATE INDEX idx_${tableName}_${column.name} ON "${tableName}" ("${column.name}");`,
        ),
      );

    await Promise.all(indexPromises);

    return { success: true };
  } catch (error: any) {
    console.error('Error creating table:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get table schema from the database
 *
 * @param projectId Neon project ID
 * @param branchId Neon branch ID
 * @param databaseName Database name
 * @param tableName Table name to describe
 * @returns Table schema from database
 */
export async function getTableSchema(
  projectId: string,
  branchId: string | undefined,
  databaseName: string,
  tableName: string,
): Promise<any> {
  try {
    const connectionString = await getConnectionString(
      projectId,
      branchId,
      databaseName,
    );
    const runQuery = neon(connectionString);

    // Query for column information
    const columnsQuery = `
      SELECT 
        column_name, 
        data_type, 
        character_maximum_length, 
        is_nullable, 
        column_default,
        (
          SELECT
            case when count(*)>0 then true else false end
          FROM
            information_schema.table_constraints AS tc
            JOIN information_schema.constraint_column_usage AS ccu ON tc.constraint_name = ccu.constraint_name
          WHERE
            tc.constraint_type = 'PRIMARY KEY'
            AND tc.table_name = c.table_name
            AND ccu.column_name = c.column_name
        ) AS is_primary_key
      FROM 
        information_schema.columns c
      WHERE 
        table_name = $1
        AND table_schema = 'public'
      ORDER BY 
        ordinal_position;
    `;

    const columns = await runQuery(columnsQuery, [tableName]);

    // Query for indexes
    const indexesQuery = `
      SELECT
        i.relname AS index_name,
        a.attname AS column_name
      FROM
        pg_index ix
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_class t ON t.oid = ix.indrelid
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      WHERE
        t.relname = $1
        AND t.relkind = 'r'
        AND i.relkind = 'i'
      ORDER BY
        i.relname;
    `;

    const indexes = await runQuery(indexesQuery, [tableName]);

    // Process results
    const processedColumns = columns.map((col: any) => ({
      name: col.column_name,
      dataType: col.data_type,
      nullable: col.is_nullable === 'YES',
      defaultValue: col.column_default,
      isPrimaryKey: col.is_primary_key,
    }));

    // Add index information
    const indexedColumns = new Set(indexes.map((idx: any) => idx.column_name));
    processedColumns.forEach((col: any) => {
      col.isIndexed = indexedColumns.has(col.name);
    });

    return {
      tableName,
      columns: processedColumns,
    };
  } catch (error: any) {
    console.error('Error getting table schema:', error);
    throw new Error(`Could not get table schema: ${error.message}`);
  }
}

/**
 * Execute a batch insert of CSV data
 *
 * @param projectId Neon project ID
 * @param branchId Neon branch ID
 * @param databaseName Database name
 * @param tableName Target table name
 * @param rows Data rows to insert
 * @param columnMapping Mapping from CSV columns to DB columns
 * @param options Import options
 * @returns Import results with statistics
 */
export async function executeImport(
  projectId: string,
  branchId: string | undefined,
  databaseName: string,
  tableName: string,
  rows: any[],
  columnMapping: Record<string, string>,
  options: {
    batchSize?: number;
    onConflict?: string;
  } = {},
): Promise<any> {
  const { batchSize = 1000, onConflict = 'skip' } = options;

  const results = {
    totalRows: rows.length,
    importedRows: 0,
    skippedRows: 0,
    errorRows: 0,
    batches: [] as any[],
    startTime: Date.now(),
    endTime: 0,
    executionTimeSeconds: 0,
  };

  try {
    const connectionString = await getConnectionString(
      projectId,
      branchId,
      databaseName,
    );
    const runQuery = neon(connectionString);

    // Import in batches
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + Math.min(batchSize, rows.length - i));
      const batchResult = {
        batchNumber: Math.floor(i / batchSize) + 1,
        startRow: i + 1,
        endRow: i + batch.length,
        rowCount: batch.length,
        success: false,
        error: null as any,
      };

      try {
        // Generate SQL for this batch
        const sql = generateBatchInsertSql(
          tableName,
          batch,
          columnMapping,
          onConflict,
        );

        // Execute the batch insert
        await runQuery(sql);

        batchResult.success = true;
        results.importedRows += batch.length;
      } catch (error: any) {
        batchResult.success = false;
        batchResult.error = error.message;

        if (onConflict === 'skip') {
          results.skippedRows += batch.length;
        } else {
          results.errorRows += batch.length;
        }
      }

      results.batches.push(batchResult);
    }

    // Calculate execution time
    results.endTime = Date.now();
    results.executionTimeSeconds = (results.endTime - results.startTime) / 1000;

    return results;
  } catch (error: any) {
    console.error('Error executing import:', error);
    throw new Error(`Import failed: ${error}`);
  }
}

/**
 * Generate SQL for batch insert
 *
 * @param tableName Target table name
 * @param rows Data rows to insert
 * @param columnMapping Column mapping from CSV to DB
 * @param onConflict Conflict handling strategy
 * @returns SQL statement for batch insert
 */
function generateBatchInsertSql(
  tableName: string,
  rows: any[],
  columnMapping: Record<string, string>,
  onConflict: string,
): string {
  const dbColumns = Object.values(columnMapping);
  const csvColumns = Object.keys(columnMapping);
  const columnNames = dbColumns.map((col) => `"${col}"`).join(', ');

  const valuesList = rows
    .map((row) => {
      const values = csvColumns.map((csvCol) => {
        const value = row[csvCol];
        // Format value for SQL
        return formatValueForSql(value);
      });
      return `(${values.join(', ')})`;
    })
    .join(',\n');

  // Basic INSERT statement
  let sql = `INSERT INTO "${tableName}" (${columnNames}) VALUES\n${valuesList}`;

  // Add conflict handling
  switch (onConflict) {
    case 'skip':
      sql += ' ON CONFLICT DO NOTHING';
      break;
    case 'update': {
      const updateColumns = dbColumns.filter(
        (col) => !col.toLowerCase().includes('id'),
      );
      if (updateColumns.length > 0) {
        const updateClause = updateColumns
          .map((col) => `"${col}" = EXCLUDED."${col}"`)
          .join(', ');
        sql += ` ON CONFLICT (${dbColumns[0]}) DO UPDATE SET ${updateClause}`;
      } else {
        sql += ' ON CONFLICT DO NOTHING';
      }
      break;
    }
    case 'replace':
      // For replace, we delete and insert (simulation of REPLACE INTO)
      sql = `WITH deleted AS (
        DELETE FROM "${tableName}" 
        WHERE "${dbColumns[0]}" IN (${rows.map((row) => formatValueForSql(row[csvColumns[0]])).join(', ')})
      )
      ${sql}`;
      break;
  }

  return sql;
}

/**
 * Format a value for SQL insertion
 *
 * @param value Value to format
 * @returns SQL-formatted value
 */
function formatValueForSql(value: any): string {
  if (value === null || value === '') {
    return 'NULL';
  }

  // Escape single quotes and backslashes
  if (typeof value === 'string') {
    const escaped = value.replace(/'/g, "''").replace(/\\/g, '\\\\');
    return `'${escaped}'`;
  }

  // Numbers can be used as-is
  if (!isNaN(Number(value))) {
    return value;
  }

  // Default case, treat as string
  const escaped = String(value).replace(/'/g, "''").replace(/\\/g, '\\\\');
  return `'${escaped}'`;
}
