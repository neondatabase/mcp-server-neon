import { ColumnAnalysis } from './csv-parser.js';

export type TableSchema = {
  columns: SchemaColumn[];
}

export type SchemaColumn = {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  needsIndex: boolean;
}

/**
 * Generate a schema for table creation based on CSV analysis
 * 
 * @param columnAnalysis Analysis of CSV columns with type inference
 * @param primaryKeyCandidate Column identified as potential primary key
 * @returns Table schema suitable for creating a PostgreSQL table
 */
export function generateTableSchema(
  columnAnalysis: ColumnAnalysis[], 
  primaryKeyCandidate: string | null
): TableSchema {
  const schema: TableSchema = {
    columns: columnAnalysis.map(column => ({
      name: sanitizeColumnName(column.name),
      dataType: mapToPostgresType(column.inferred.type),
      nullable: column.nonNullPercentage < 95, // Suggest NOT NULL if >95% of values are non-null
      isPrimaryKey: column.name === primaryKeyCandidate,
      needsIndex:
        column.uniquePercentage > 80 ||
        column.name.toLowerCase().includes('id'),
    })),
  };

  return schema;
}

/**
 * Sanitize column names for PostgreSQL
 * 
 * @param name Raw column name from CSV
 * @returns PostgreSQL-compatible column name
 */
export function sanitizeColumnName(name: string): string {
  // Replace spaces and special characters with underscores
  let sanitized = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '_');

  // Ensure name doesn't start with a number
  if (/^[0-9]/.test(sanitized)) {
    sanitized = 'col_' + sanitized;
  }

  return sanitized;
}

/**
 * Map inferred types to PostgreSQL data types
 * 
 * @param inferredType The type inferred from CSV data
 * @returns PostgreSQL data type
 */
export function mapToPostgresType(inferredType: string): string {
  switch (inferredType) {
    case 'integer':
      return 'INTEGER';
    case 'bigint':
      return 'BIGINT';
    case 'numeric':
      return 'NUMERIC';
    case 'date':
      return 'DATE';
    case 'timestamp':
      return 'TIMESTAMP';
    case 'boolean':
      return 'BOOLEAN';
    case 'text':
    default:
      return 'TEXT';
  }
}

/**
 * Format schema proposal for user display
 * 
 * @param tableName Name of the table to be created
 * @param schema Generated table schema
 * @param csvAnalysis CSV analysis result
 * @returns Formatted schema proposal text
 */
export function formatSchemaProposal(
  tableName: string,
  schema: TableSchema,
  csvAnalysis: any
): string {
  let output = `I've analyzed your CSV file and the table "${tableName}" doesn't exist yet.\n\n`;

  // Add CSV preview
  output += `CSV Preview (${Math.min(5, csvAnalysis.rows.length)} of ${csvAnalysis.recordCount} rows):\n`;

  // Create header row for the preview table
  const headers = csvAnalysis.headerRow;
  const headerDisplay = headers.join(' | ');
  const separator = headers.map(() => '----').join('-|-');

  output += `${headerDisplay}\n${separator}\n`;

  // Add preview rows
  csvAnalysis.previewRows.slice(0, 5).forEach((row: any) => {
    const rowDisplay = headers
      .map((header: any) => String(row[header] || ''))
      .join(' | ');
    output += `${rowDisplay}\n`;
  });

  output += '\nProposed Table Schema:\n';

  // Display column details
  schema.columns.forEach((column) => {
    let columnDesc = `- ${column.name}: ${column.dataType}`;
    if (column.isPrimaryKey) columnDesc += ' (Primary Key)';
    if (!column.nullable) columnDesc += ' (NOT NULL)';
    if (column.needsIndex && !column.isPrimaryKey) columnDesc += ' (Indexed)';
    output += `${columnDesc}\n`;
  });

  output += '\nWould you like to:\n';
  output += '1. Create the table with this schema and proceed with import\n';
  output += '2. Modify the schema before creating\n';
  output += '3. Choose a different existing table instead';

  return output;
}