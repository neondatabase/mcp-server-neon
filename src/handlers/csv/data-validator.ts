export type ValidationResult = {
    hasErrors: boolean;
    errors: any[];
    warnings: any[];
    mapping: Record<string, string>;
  };
  
  /**
   * Validate data against table schema
   * 
   * @param csvAnalysis Analysis of CSV data
   * @param columnMapping Column mapping from CSV to DB
   * @param tableSchema Table schema from database
   * @returns Validation results with errors and warnings
   */
  export function validateData(
    csvAnalysis: any,
    columnMapping: Record<string, string>,
    tableSchema: any
  ): ValidationResult {
    const errors = [];
    const warnings = [];
  
    // Check if any required columns are missing from mapping
    const mappedColumns = new Set(Object.values(columnMapping));
    const missingRequiredColumns = tableSchema.columns
      .filter(
        (col: any) =>
          !col.nullable && !col.defaultValue && !mappedColumns.has(col.name),
      )
      .map((col: any) => col.name);
  
    if (missingRequiredColumns.length > 0) {
      errors.push({
        type: 'missing_required_columns',
        message: `Missing required columns: ${missingRequiredColumns.join(', ')}`,
        columns: missingRequiredColumns,
      });
    }
  
    // Check sample rows for type compatibility
    const dbColumnsByName: Record<string, any> = {};
    tableSchema.columns.forEach((col: any) => {
      dbColumnsByName[col.name] = col;
    });
  
    // Validate a sample of rows
    const sampleSize = Math.min(csvAnalysis.rows.length, 10);
    for (let i = 0; i < sampleSize; i++) {
      const row = csvAnalysis.rows[i];
      const rowErrors = [];
  
      // Check each mapped column
      for (const csvCol in columnMapping) {
        const dbCol = columnMapping[csvCol];
        const dbColSchema = dbColumnsByName[dbCol];
        const value = row[csvCol];
  
        // Skip NULL values if column allows nulls
        if ((value === null || value === '') && dbColSchema.nullable) {
          continue;
        }
  
        // Check required values
        if ((value === null || value === '') && !dbColSchema.nullable) {
          rowErrors.push({
            column: csvCol,
            targetColumn: dbCol,
            message: `Required column cannot be null`,
          });
          continue;
        }
  
        // Type validation based on PostgreSQL data type
        if (value !== null && value !== '') {
          const typeError = validateValueType(value, dbColSchema.dataType);
          if (typeError) {
            rowErrors.push({
              column: csvCol,
              targetColumn: dbCol,
              message: typeError,
            });
          }
        }
      }
  
      if (rowErrors.length > 0) {
        errors.push({
          row: i + 1,
          errors: rowErrors,
        });
      }
    }
  
    // Check CSV columns with no mapping
    const unmappedCsvColumns = csvAnalysis.headerRow.filter(
      (header: any) => !columnMapping[header],
    );
  
    if (unmappedCsvColumns.length > 0) {
      warnings.push({
        type: 'unmapped_columns',
        message: `The following CSV columns will not be imported: ${unmappedCsvColumns.join(', ')}`,
        columns: unmappedCsvColumns,
      });
    }
  
    return {
      hasErrors: errors.length > 0,
      errors,
      warnings,
      mapping: columnMapping,
    };
  }
  
  /**
   * Validate a value against expected PostgreSQL data type
   * 
   * @param value Value to validate
   * @param dataType PostgreSQL data type
   * @returns Error message or null if valid
   */
  export function validateValueType(value: any, dataType: string): string | null {
    const upperType = dataType.toUpperCase();
  
    if (
      upperType.includes('INT') ||
      upperType === 'BIGINT' ||
      upperType === 'SMALLINT'
    ) {
      // Integer types
      if (isNaN(Number(value)) || !Number.isInteger(Number(value))) {
        return `Value "${value}" is not a valid integer`;
      }
  
      // Check range limits for specific types
      if (
        upperType === 'SMALLINT' &&
        (Number(value) < -32768 || Number(value) > 32767)
      ) {
        return `Value "${value}" is out of range for SMALLINT`;
      }
      if (
        upperType === 'INTEGER' &&
        (Number(value) < -2147483648 || Number(value) > 2147483647)
      ) {
        return `Value "${value}" is out of range for INTEGER`;
      }
    } else if (
      upperType === 'NUMERIC' ||
      upperType === 'DECIMAL' ||
      upperType.includes('FLOAT')
    ) {
      // Numeric types
      if (isNaN(Number(value))) {
        return `Value "${value}" is not a valid number`;
      }
    } else if (upperType === 'BOOLEAN') {
      // Boolean type - check if convertible to boolean
      const boolStrings = [
        'true',
        'false',
        'yes',
        'no',
        't',
        'f',
        'y',
        'n',
        '1',
        '0',
      ];
      if (!boolStrings.includes(String(value).toLowerCase())) {
        return `Value "${value}" is not a valid boolean`;
      }
    } else if (upperType === 'DATE') {
      // Date type
      if (!isValidDate(value)) {
        return `Value "${value}" is not a valid date`;
      }
    } else if (upperType.includes('TIMESTAMP')) {
      // Timestamp type
      if (!isValidTimestamp(value)) {
        return `Value "${value}" is not a valid timestamp`;
      }
    }
  
    // For TEXT and other types, no validation needed
    return null;
  }
  
  /**
   * Check if a string represents a valid date
   */
  function isValidDate(value: string): boolean {
    if (typeof value !== 'string') return false;
  
    // Check common date formats: YYYY-MM-DD, MM/DD/YYYY, DD-MM-YYYY
    const dateRegexes = [
      /^\d{4}-\d{2}-\d{2}$/,
      /^\d{1,2}\/\d{1,2}\/\d{4}$/,
      /^\d{1,2}-\d{1,2}-\d{4}$/,
    ];
  
    if (!dateRegexes.some(regex => regex.test(value))) return false;
  
    // Try parsing the date
    const date = new Date(value);
    return !isNaN(date.getTime());
  }
  
  /**
   * Check if a string represents a valid timestamp
   */
  function isValidTimestamp(value: string): boolean {
    if (typeof value !== 'string') return false;
  
    // Check common timestamp formats
    const timestampRegexes = [
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/,
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/,
    ];
  
    if (!timestampRegexes.some(regex => regex.test(value))) return false;
  
    // Try parsing the timestamp
    const date = new Date(value);
    return !isNaN(date.getTime());
  }
  
  /**
   * Format validation results for user display
   * 
   * @param validationResults Validation results
   * @param tableName Target table name
   * @returns Formatted validation results message
   */
  export function formatValidationResults(
    validationResults: ValidationResult,
    tableName: string
  ): string {
    let output = `Validation results for importing to table "${tableName}":\n\n`;
  
    if (validationResults.hasErrors) {
      output += `⚠️ There are validation errors that must be fixed before importing:\n\n`;
  
      // Display missing required columns
      const missingRequired = validationResults.errors.find(
        (e: any) => e.type === 'missing_required_columns',
      );
      if (missingRequired) {
        output += `Missing required columns: ${missingRequired.columns.join(', ')}\n`;
        output += `These columns are required and don't have default values in the database.\n\n`;
      }
  
      // Display row-level errors (up to 5)
      const rowErrors = validationResults.errors.filter(
        (e: any) => e.row !== undefined,
      );
      if (rowErrors.length > 0) {
        output += `Data validation errors (showing ${Math.min(5, rowErrors.length)} of ${rowErrors.length}):\n`;
  
        rowErrors.slice(0, 5).forEach((error: any) => {
          output += `- Row ${error.row}: `;
          error.errors.forEach((err: any) => {
            output += `Column "${err.column}" (mapped to "${err.targetColumn}"): ${err.message}. `;
          });
          output += '\n';
        });
  
        output += '\n';
      }
    }
  
    // Show warnings
    if (validationResults.warnings && validationResults.warnings.length > 0) {
      output += `Warnings (non-blocking issues):\n`;
      validationResults.warnings.forEach((warning: any) => {
        output += `- ${warning.message}\n`;
      });
      output += '\n';
    }
  
    // Show column mapping
    output += `Column Mapping:\n`;
    for (const csvCol in validationResults.mapping) {
      output += `- CSV: "${csvCol}" → DB: "${validationResults.mapping[csvCol]}"\n`;
    }
  
    if (validationResults.hasErrors) {
      output += `\nPlease fix these issues before importing the data.`;
    } else {
      output += `\nValidation passed. The data is ready to import.`;
    }
  
    return output;
  }