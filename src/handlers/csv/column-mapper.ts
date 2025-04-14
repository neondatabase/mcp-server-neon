import { sanitizeColumnName } from './schema-generator.js';

/**
 * Resolve column mapping between CSV and database table
 * 
 * @param csvHeaders CSV header row
 * @param tableSchema Database table schema
 * @param userMapping Optional user-provided column mapping
 * @returns Mapping from CSV columns to DB columns
 */
export function resolveColumnMapping(
  csvHeaders: string[],
  tableSchema: any,
  userMapping?: Record<string, string>
): Record<string, string> {
  // If user provided a mapping, validate and use it
  if (userMapping) {
    // Check that all target columns exist in the table
    const tableColumns = new Set(
      tableSchema.columns.map((col: any) => col.name),
    );
    for (const csvCol in userMapping) {
      const dbCol = userMapping[csvCol];
      if (!tableColumns.has(dbCol)) {
        throw new Error(
          `Column mapping error: Table column "${dbCol}" doesn't exist`,
        );
      }
    }
    return userMapping;
  }

  // Auto-generate mapping based on name similarity
  const mapping: Record<string, string> = {};
  const dbColumnsByName: Record<string, any> = {};

  // Create lookup for table columns
  tableSchema.columns.forEach((col: any) => {
    dbColumnsByName[col.name] = col;
  });

  // Try to match CSV headers to table columns
  csvHeaders.forEach((header) => {
    const sanitizedHeader = sanitizeColumnName(header);

    // Exact match
    if (dbColumnsByName[sanitizedHeader]) {
      mapping[header] = sanitizedHeader;
      return;
    }

    // Case-insensitive match
    const lowerHeader = sanitizedHeader.toLowerCase();
    for (const dbCol in dbColumnsByName) {
      if (dbCol.toLowerCase() === lowerHeader) {
        mapping[header] = dbCol;
        return;
      }
    }

    // Partial match (contains)
    for (const dbCol in dbColumnsByName) {
      if (
        dbCol.includes(lowerHeader) ||
        lowerHeader.includes(dbCol.toLowerCase())
      ) {
        mapping[header] = dbCol;
        return;
      }
    }

    // No match found for this header
  });

  return mapping;
}

/**
 * Format dry run results for user display
 * 
 * @param csvAnalysis CSV analysis results
 * @param columnMapping Column mapping from CSV to DB
 * @param tableName Target table name
 * @returns Formatted dry run message
 */
export function formatDryRunResults(
  csvAnalysis: any,
  columnMapping: Record<string, string>,
  tableName: string
): string {
  let output = `Dry run for importing to table "${tableName}":\n\n`;

  output += `Found ${csvAnalysis.recordCount} records in the CSV file.\n\n`;

  // Show column mapping
  output += `Column Mapping:\n`;
  for (const csvCol in columnMapping) {
    output += `- CSV: "${csvCol}" → DB: "${columnMapping[csvCol]}"\n`;
  }

  // Show unmapped columns
  const unmappedColumns = csvAnalysis.headerRow.filter(
    (h: any) => !columnMapping[h],
  );
  if (unmappedColumns.length > 0) {
    output += `\nUnmapped columns (will not be imported):\n`;
    unmappedColumns.forEach((col: any) => {
      output += `- "${col}"\n`;
    });
  }

  // Show preview with mapping
  output += `\nPreview of data to be imported:\n`;
  const mappedHeaders = Object.keys(columnMapping).map(
    (csvCol) => `${csvCol} → ${columnMapping[csvCol]}`,
  );

  output += mappedHeaders.join(' | ') + '\n';
  output += mappedHeaders.map(() => '----').join('-|-') + '\n';

  // Show a few sample rows
  csvAnalysis.previewRows.slice(0, 3).forEach((row: any) => {
    const rowDisplay = Object.keys(columnMapping)
      .map((csvCol) => String(row[csvCol] || ''))
      .join(' | ');
    output += rowDisplay + '\n';
  });

  output += `\nThis is a dry run. No data has been imported. To import data, run again without the dryRun option.`;

  return output;
}

/**
 * Format import results for user display
 * 
 * @param results Import results
 * @param tableName Target table name
 * @returns Formatted import results message
 */
export function formatImportResults(results: any, tableName: string): string {
  let output = `Import to table "${tableName}" completed:\n\n`;

  output += `📊 Summary:\n`;
  output += `- Total records: ${results.totalRows}\n`;
  output += `- Successfully imported: ${results.importedRows}\n`;

  if (results.skippedRows > 0) {
    output += `- Skipped: ${results.skippedRows}\n`;
  }

  if (results.errorRows > 0) {
    output += `- Failed: ${results.errorRows}\n`;
  }

  output += `- Execution time: ${results.executionTimeSeconds.toFixed(2)} seconds\n`;

  // Batch details (summarized)
  const successfulBatches = results.batches.filter((b: any) => b.success).length;
  const failedBatches = results.batches.filter((b: any) => !b.success).length;

  output += `\n📦 Batch processing:\n`;
  output += `- Total batches: ${results.batches.length}\n`;
  output += `- Successful batches: ${successfulBatches}\n`;

  if (failedBatches > 0) {
    output += `- Failed batches: ${failedBatches}\n\n`;

    // Show error details for the first few failed batches
    output += `❌ Error details (first ${Math.min(3, failedBatches)} failures):\n`;
    let errorCount = 0;
    for (const batch of results.batches) {
      if (!batch.success && errorCount < 3) {
        output += `- Batch ${batch.batchNumber} (rows ${batch.startRow}-${batch.endRow}): ${batch.error}\n`;
        errorCount++;
      }
    }
  }

  return output;
}